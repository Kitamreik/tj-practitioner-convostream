/**
 * Safeguarding checklist visibility contract.
 *
 * The HarmImpactChecklist contains agent-only affirmations about who has been
 * impacted, who is on the support team, preferred comms, and triggers. It
 * MUST NOT appear in the customer-facing portal, and on the agent side it
 * MUST stay masked until the agent re-enters their account password.
 *
 * We can't run Firestore inside the Vitest sandbox, so this suite pins the
 * contract by inspecting the source files that mount the component and the
 * component itself. Any regression — exposing the checklist on the customer
 * portal, dropping the password gate, or unsubscribing from the affirmations
 * doc — fails the build before it reaches prod.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "..");
const checklistSrc = readFileSync(
  join(root, "components/HarmImpactChecklist.tsx"),
  "utf8",
);
const chatSrc = readFileSync(join(root, "pages/Chat.tsx"), "utf8");
const convosSrc = readFileSync(join(root, "pages/Conversations.tsx"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("HarmImpactChecklist visibility contract", () => {
  it("never imported under the customer portal tree", () => {
    const portalFiles = walk(join(root, "pages/portal"));
    expect(portalFiles.length).toBeGreaterThan(0);
    for (const f of portalFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must not import HarmImpactChecklist`).not.toMatch(
        /HarmImpactChecklist/,
      );
    }
  });

  it("Chat.tsx only mounts the checklist when the viewer is not a customer", () => {
    // Role gate is wired so the checklist never enters the DOM for customers.
    expect(chatSrc).toMatch(/isCustomer\s*=\s*profile\?\.role\s*===\s*["']customer["']/);
    expect(chatSrc).toMatch(
      /!isCustomer\s*&&\s*\n?\s*<HarmImpactChecklist|activeId\s*&&\s*!isCustomer[^]{0,200}<HarmImpactChecklist/,
    );
  });

  it("Conversations.tsx mounts the checklist (agent-only page, no customer role reaches it)", () => {
    expect(convosSrc).toMatch(/<HarmImpactChecklist\s+parentCollection=["']conversations["']/);
  });

  it("checklist component defaults to password-gated masking and requires re-auth to reveal", () => {
    // Default `requirePassword` to true so any caller that forgets to pass
    // the prop still gets the masked-by-default behaviour.
    expect(checklistSrc).toMatch(/requirePassword\s*=\s*true/);
    // The "locked" view renders a Reveal button that opens the re-auth dialog.
    expect(checklistSrc).toMatch(/SecurityReauthDialog/);
    expect(checklistSrc).toMatch(/Reveal/);
    expect(checklistSrc).toMatch(/Safeguarding checklist is masked/);
    // Subscription is gated on `unlocked` so notes never load into memory
    // under a locked screen.
    expect(checklistSrc).toMatch(/if\s*\(\s*!parentId\s*\|\|\s*!unlocked\s*\)/);
  });

  it("successful re-auth caches the unlock for 15 minutes via sessionStorage", () => {
    expect(checklistSrc).toMatch(/UNLOCK_TTL_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    expect(checklistSrc).toMatch(/sessionStorage\.setItem/);
    expect(checklistSrc).toMatch(/writeUnlockedUntil\(profile\?\.uid,\s*until\)/);
  });

  it("checklist persists entries to affirmations/harmImpact via setDoc + onSnapshot", () => {
    // Same Firestore path on read and write — guarantees what an agent
    // checks off is what re-renders after a refresh.
    expect(checklistSrc).toMatch(
      /doc\(\s*db,\s*parentCollection,\s*parentId,\s*["']affirmations["'],\s*["']harmImpact["']\s*\)/,
    );
    expect(checklistSrc).toMatch(/onSnapshot\(/);
    expect(checklistSrc).toMatch(/setDoc\(/);
    expect(checklistSrc).toMatch(/\{\s*merge:\s*true\s*\}/);
  });
});

describe("Link-to-customer persistence contract", () => {
  it("Chat.tsx writes linkedConversationId on the chat thread and linkedChatThreadId on the conversation", () => {
    expect(chatSrc).toMatch(/linkedConversationId\s*:\s*conversationId/);
    expect(chatSrc).toMatch(/linkedChatThreadId\s*:\s*threadId/);
    expect(chatSrc).toMatch(/updateDoc\(\s*doc\(db,\s*["']chatThreads["']/);
    expect(chatSrc).toMatch(/updateDoc\(\s*doc\(db,\s*["']conversations["']/);
  });

  it("Chat header re-renders the 'Open linked conversation' shortcut after refresh", () => {
    // The button only renders when the persisted id is read back from the
    // thread doc — which is what makes the link survive a reload.
    expect(chatSrc).toMatch(/activeThread\.linkedConversationId/);
    expect(chatSrc).toMatch(/Open linked conversation/);
  });

  it("Conversations detail surfaces the linked chat thread on reload", () => {
    expect(convosSrc).toMatch(/linkedChatThreadId/);
    expect(convosSrc).toMatch(/Linked chat thread/);
  });
});
