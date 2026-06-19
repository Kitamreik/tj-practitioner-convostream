/**
 * portalChatAndEscalate.e2e.test.ts
 *
 * Contract tests for the customer-portal Team Chat surface and the new
 * Escalate-to-Webmaster modal. These tests are file-text assertions
 * (Vitest, no jsdom), matching the style of other *.e2e.test.ts files
 * in this repo. They are intentionally cheap to run and catch the most
 * common regressions:
 *   - Customer landing page is /portal/chat (NOT the agent Home / NOT
 *     a conversations console).
 *   - PortalChat does not import the agent Welcome / Home / Conversations
 *     surfaces or agent-only analytics pages.
 *   - Escalate-to-Webmaster is now a modal triggered by a single button,
 *     hidden for customers/webmaster, and persists drafts to localStorage.
 *   - NewConversationDialog persists drafts to localStorage and never
 *     clears them on submit error (production failsafe).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("Customer portal Team Chat is the default surface", () => {
  it("App.tsx routes /portal and /portal/conversations to /portal/chat", () => {
    const src = read("src/App.tsx");
    expect(src).toMatch(/path="\/portal"\s+element=\{<Navigate to="\/portal\/chat" replace/);
    expect(src).toMatch(/path="\/portal\/conversations"\s+element=\{<Navigate to="\/portal\/chat" replace/);
  });

  it("App.tsx mounts PortalChat (not PortalConversations) at /portal/chat", () => {
    const src = read("src/App.tsx");
    expect(src).toMatch(/path="\/portal\/chat"[\s\S]{0,120}<PortalChat\s*\/>/);
    // The legacy PortalConversations import is dropped from App.tsx so the
    // agent welcome/console view can never be rendered for customers.
    expect(src).not.toMatch(/^import PortalConversations from/m);
  });

  it("customer role redirects in ProtectedRoute land on /portal/chat", () => {
    const src = read("src/App.tsx");
    const matches = src.match(/role === "customer"\) return <Navigate to="\/portal\/chat"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("PortalChat is the customer-only Team Chat", () => {
  const portal = read("src/pages/portal/PortalChat.tsx");

  it("never imports the agent Welcome / Home / Conversations / analytics pages", () => {
    expect(portal).not.toMatch(/from\s+["']@\/pages\/Home["']/);
    expect(portal).not.toMatch(/from\s+["']@\/pages\/Conversations["']/);
    expect(portal).not.toMatch(/from\s+["']@\/pages\/AgentLogs["']/);
    expect(portal).not.toMatch(/from\s+["']@\/pages\/CallAnalytics["']/);
    expect(portal).not.toMatch(/from\s+["']@\/pages\/Analytics["']/);
  });

  it("uses chat helpers and filters customers out of the agent picker", () => {
    expect(portal).toMatch(/listOtherUsers/);
    expect(portal).toMatch(/subscribeMyThreads/);
    expect(portal).toMatch(/openOrCreateDmThread/);
    expect(portal).toMatch(/sendChatMessage/);
    // Picker filters customers — customers should only DM agents.
    expect(portal).toMatch(/role\s*!==\s*["']customer["']/);
  });

  it("auto-saves the composer draft to localStorage per thread (failsafe)", () => {
    expect(portal).toMatch(/ConvoHub\.portalChat\.draft\./);
    expect(portal).toMatch(/localStorage\.setItem\(draftKey/);
    expect(portal).toMatch(/localStorage\.removeItem\(draftKey/);
  });
});

describe("EscalateWebmasterModal — modal replaces inline buttons", () => {
  const modal = read("src/components/EscalateWebmasterModal.tsx");

  it("renders inside a Dialog with a single Escalate trigger button", () => {
    expect(modal).toMatch(/<DialogTrigger asChild>/);
    expect(modal).toMatch(/Escalate to Webmaster/);
    expect(modal).toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("hides itself for customers (webmasters now see it for the push-to-Firestore action)", () => {
    expect(modal).toMatch(/profile\.role === "customer"/);
    // Webmasters intentionally see the modal so they can flush queued
    // escalation entries with the Push button.
    expect(modal).toMatch(/isWebmaster\s*=\s*profile\?\.role === "webmaster"/);
  });

  it("persists the incident note to localStorage as a failsafe", () => {
    expect(modal).toMatch(/ConvoHub\.webmasterEscalate\.draft\./);
    expect(modal).toMatch(/localStorage\.setItem\(draftKey/);
    expect(modal).toMatch(/localStorage\.removeItem\(draftKey/);
  });

  it("delegates Firebase-backed contact paths to WebmasterContactButtons", () => {
    expect(modal).toMatch(/from "@\/components\/WebmasterContactButtons"/);
    expect(modal).toMatch(/<WebmasterContactButtons/);
  });

  it("AppSidebar and BottomNav use the modal, not the inline buttons", () => {
    const sidebar = read("src/components/AppSidebar.tsx");
    const bottom = read("src/components/BottomNav.tsx");
    expect(sidebar).toMatch(/<EscalateWebmasterModal/);
    expect(bottom).toMatch(/<EscalateWebmasterModal/);
    expect(sidebar).not.toMatch(/<WebmasterContactButtons/);
    expect(bottom).not.toMatch(/<WebmasterContactButtons/);
  });
});

describe("NewConversationDialog — localStorage form failsafe", () => {
  const dlg = read("src/components/NewConversationDialog.tsx");

  it("writes the form to localStorage on every change", () => {
    expect(dlg).toMatch(/ConvoHub\.newConversation\.draft\./);
    expect(dlg).toMatch(/localStorage\.setItem\(DRAFT_KEY/);
  });

  it("retains the draft when create fails (does not call reset on error)", () => {
    // The catch branch should mention the retained draft so the agent knows
    // they can retry without retyping. `reset()` is only called on success.
    expect(dlg).toMatch(/draft is saved on this device/);
    expect(dlg).toMatch(/draft retained/);
  });

  it("clears the draft only on successful create (inside reset())", () => {
    expect(dlg).toMatch(/localStorage\.removeItem\(DRAFT_KEY\)/);
  });
});

describe("Firestore rules permit customer to read user metadata for the agent picker", () => {
  it("users collection read rule is signed-in (not internal-only)", () => {
    const rules = read("firestore.rules");
    // Look for the /users/{uid} block and confirm `allow read: if isSignedIn();`
    // is present immediately after the match line. This is what makes the
    // portal-side `listOtherUsers` succeed for customers.
    const match = rules.match(/match \/users\/\{uid\}\s*\{[\s\S]{0,400}/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/allow read:\s*if isSignedIn\(\);/);
  });
});
