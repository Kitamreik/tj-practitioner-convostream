/**
 * End-to-end contract tests for the customer approval flow.
 *
 * Covers (file-level, no Firebase emulator required):
 *  1. signUpCustomer creates a `users/{uid}` profile with role="customer"
 *     and `approvalStatus: "pending"` (NOT auto-approved).
 *  2. The portal landing page is PortalChat (Team Chat) — never an agent
 *     "Welcome" console or conversations list.
 *  3. The Login customer tab redirects to /portal/chat after signup/sign-in.
 *  4. CustomerRoute renders the PortalPending screen when the profile is
 *     pending or rejected — customers cannot reach the Team Chat until a
 *     webmaster/admin approves them.
 *  5. SignupApprovalsPanel shows a "Customer signup" badge for customer
 *     role pending rows and skips the agent-roster check.
 *  6. PortalChat exposes a profile editor wired to `updateCustomerProfile`.
 *  7. The webmaster seeder writes pending customer signup demo rows.
 *  8. Customer-facing surfaces never import Gmail / Agent Logs / Call
 *     Analytics / Conversations pages.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Customer approval flow — e2e contract", () => {
  it("signUpCustomer assigns customer role + pending approval status", () => {
    const src = read("src/lib/customerPortal.ts");
    expect(src).toMatch(/role:\s*"customer"/);
    expect(src).toMatch(/approvalStatus:\s*"pending"/);
    // The previous auto-approved path must be gone.
    expect(src).not.toMatch(/approvalStatus:\s*"approved"/);
  });

  it("Login + PortalSignup redirect customers to /portal/chat (Team Chat), not conversations", () => {
    const login = read("src/pages/Login.tsx");
    const signup = read("src/pages/portal/PortalSignup.tsx");
    expect(login).toContain('navigate("/portal/chat"');
    expect(signup).toContain('navigate("/portal/chat"');
    expect(login).not.toContain('navigate("/portal/conversations"');
    expect(signup).not.toContain('navigate("/portal/conversations"');
  });

  it("App.tsx gates pending/rejected customers with a PortalPending screen", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("const PortalPending");
    expect(app).toMatch(/approvalStatus.*!==\s*"approved"/);
    // The customer landing route is Team Chat.
    expect(app).toContain('path="/portal/chat"');
    expect(app).toContain('Navigate to="/portal/chat"');
  });

  it("PortalChat is the customer landing page — no agent Welcome / conversations imports", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).toContain("Team Chat");
    // The customer chat must filter out other customers from the picker.
    expect(portal).toMatch(/u\.role\s*!==\s*"customer"/);
    // Customer portal must not import agent-only pages.
    expect(portal).not.toMatch(/from\s+"@\/pages\/(GmailAPI|AgentLogs|CallAnalytics|Conversations)"/);
    expect(portal).not.toMatch(/from\s+"@\/pages\/Home"/);
  });

  it("PortalChat exposes an editable profile dialog wired to updateCustomerProfile", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).toContain("updateCustomerProfile");
    expect(portal).toContain('id="portal-edit-name"');
    expect(portal).toContain('id="portal-edit-email"');
  });

  it("updateCustomerProfile updates Auth + Firestore and reports email errors", () => {
    const lib = read("src/lib/customerPortal.ts");
    expect(lib).toContain("export async function updateCustomerProfile");
    expect(lib).toContain("updateProfile(user");
    expect(lib).toContain("updateEmail(user");
    expect(lib).toContain('updateDoc(doc(db, "users", user.uid)');
  });

  it("SignupApprovalsPanel renders a Customer signup badge and skips roster check for customers", () => {
    const panel = read("src/components/SignupApprovalsPanel.tsx");
    expect(panel).toContain("Customer signup");
    expect(panel).toMatch(/role\s*===\s*"customer"/);
  });

  it("seedDemoData seeds pending customer signups for testing", () => {
    const seed = read("src/lib/seedDemoData.ts");
    expect(seed).toContain("seedPendingCustomerSignups");
    expect(seed).toContain('role: "customer"');
    expect(seed).toContain('approvalStatus: "pending"');
    expect(seed).toMatch(/customers:\s*number/);
  });

  it("Customer portal never imports Gmail / AgentLogs / CallAnalytics / agent Conversations", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).not.toMatch(/GmailAPI|AgentLogs|CallAnalytics/);
    // It also must not pull the agent NewConversationDialog or HarmImpactChecklist.
    expect(portal).not.toContain("NewConversationDialog");
    expect(portal).not.toContain("HarmImpactChecklist");
  });

  it("Customer route in App.tsx remains gated by CustomerRoute and does not expose /conversations", () => {
    const app = read("src/App.tsx");
    // Legacy /portal/conversations is just a redirect; no element using
    // PortalConversations should be rendered to customers.
    expect(app).not.toMatch(/<PortalConversations\s*\/>/);
    expect(app).toMatch(/path="\/portal\/conversations"\s+element=\{<Navigate to="\/portal\/chat"/);
  });
});
