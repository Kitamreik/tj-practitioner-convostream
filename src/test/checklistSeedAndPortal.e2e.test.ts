/**
 * End-to-end contract suite covering:
 *
 *   1. The customer portal never imports or renders HarmImpactChecklist —
 *      password-gated entries can't leak into a customer view.
 *   2. Opening "New Conversation" from a chat thread pre-fills the
 *      safeguarding checklist via extractChecklistSeed AND persists the
 *      seed to `conversations/{id}/affirmations/harmImpact` so it reloads
 *      after refresh.
 *   3. The Login page Customer tab signs up / signs in via the customer
 *      portal helpers, claims pre-existing conversations, and routes to
 *      `/portal/conversations`.
 *   4. The seed writer validates the target path and never overwrites an
 *      agent-edited checklist.
 *
 * Firestore can't run inside Vitest, so we pin the contracts at the source
 * level. Any regression — losing the role gate, dropping the seed write,
 * or stomping agent edits — fails the build.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, it, expect } from "vitest";
import { extractChecklistSeed, hasSeed } from "@/lib/checklistSeed";

const root = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const chatSrc = read("pages/Chat.tsx");
const loginSrc = read("pages/Login.tsx");
const dialogSrc = read("components/NewConversationDialog.tsx");
const portalHelpersSrc = read("lib/customerPortal.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Customer portal — checklist never leaks", () => {
  it("no portal file imports HarmImpactChecklist", () => {
    const portalFiles = walk(join(root, "pages/portal"));
    expect(portalFiles.length).toBeGreaterThan(0);
    for (const f of portalFiles) {
      expect(readFileSync(f, "utf8"), `${f}`).not.toMatch(/HarmImpactChecklist/);
    }
  });

  it("Chat.tsx hides the checklist for viewers with role=customer", () => {
    expect(chatSrc).toMatch(/isCustomer\s*=\s*profile\?\.role\s*===\s*["']customer["']/);
    expect(chatSrc).toMatch(/!isCustomer[^]{0,200}HarmImpactChecklist/);
  });
});

describe("Chat → New Conversation seed prefill", () => {
  it("extractChecklistSeed pulls notes from customer messages and skips agent ones", () => {
    const seed = extractChecklistSeed(
      [
        { body: "My sister has been hurting me for years. Please call me, not text.", senderUid: "cust" },
        { body: "My sister harmed me for years. Please call me, not text.", senderUid: "cust" },
        { body: "Hi — what's going on?", senderUid: "agent" },
        { body: "I have a therapist who knows. Avoid talking about my father.", senderUid: "cust" },
      ],
      "agent",
    );
    );
    expect(hasSeed(seed)).toBe(true);
    expect(seed.items.harmedParties?.note).toMatch(/hurt/i);
    expect(seed.items.supportTeam?.note).toMatch(/therapist/i);
    expect(seed.items.preferredComms?.note).toMatch(/call me/i);
    expect(seed.items.triggers?.note).toMatch(/avoid|father/i);
    // Conservative: never auto-tick.
    for (const v of Object.values(seed.items)) expect(v.checked).toBe(false);
  });

  it("Chat.tsx wires extractChecklistSeed into the NewConversationDialog", () => {
    expect(chatSrc).toMatch(/extractChecklistSeed\(messages,\s*user\.uid\)/);
    expect(chatSrc).toMatch(/initialChecklist=\{convertChecklistSeed\}/);
  });

  it("NewConversationDialog persists the seed to the exact affirmations/harmImpact path", () => {
    expect(dialogSrc).toMatch(
      /doc\(\s*db,\s*["']conversations["'],\s*convoId,\s*["']affirmations["'],\s*["']harmImpact["']\s*\)/,
    );
    expect(dialogSrc).toMatch(/seededFrom:\s*["']chat-conversion["']/);
    expect(dialogSrc).toMatch(/\{\s*merge:\s*true\s*\}/);
  });
});

describe("Seed writer — validation and no-overwrite guarantees", () => {
  it("validates the conversation id before writing and logs the path", () => {
    expect(dialogSrc).toMatch(/aborting: empty conversation id/);
    expect(dialogSrc).toMatch(/\[checklist-seed\] wrote seed/);
    expect(dialogSrc).toMatch(/path:\s*seedRef\.path/);
  });

  it("reads existing checklist and skips when agent edits already exist", () => {
    expect(dialogSrc).toMatch(/const existing = await getDoc\(seedRef\)/);
    expect(dialogSrc).toMatch(/hasAgentEdits/);
    expect(dialogSrc).toMatch(/skipped — agent edits present/);
  });
});

describe("Login — Customer tab end to end contract", () => {
  it("renders Staff and Customer tabs with separate submit handlers", () => {
    expect(loginSrc).toMatch(/TabsTrigger value="staff"/);
    expect(loginSrc).toMatch(/TabsTrigger value="customer"/);
    expect(loginSrc).toMatch(/handleCustomerSubmit/);
    expect(loginSrc).toMatch(/handleStaffSubmit/);
  });

  it("customer sign-up uses signUpCustomer and routes to /portal/conversations", () => {
    expect(loginSrc).toMatch(/signUpCustomer\(/);
    expect(loginSrc).toMatch(/navigate\("\/portal\/conversations",\s*\{\s*replace:\s*true\s*\}\)/);
  });

  it("customer sign-in claims prior conversations to keep history consistent", () => {
    expect(loginSrc).toMatch(/signInWithEmailAndPassword\(auth,/);
    expect(loginSrc).toMatch(/claimConversationsForCustomer\(cred\.user\.uid,/);
  });

  it("signUpCustomer creates role=customer profile, logs the signup, then claims conversations", () => {
    expect(portalHelpersSrc).toMatch(/role:\s*["']customer["']/);
    expect(portalHelpersSrc).toMatch(/approvalStatus:\s*["']approved["']/);
    expect(portalHelpersSrc).toMatch(/customerSignupLog/);
    expect(portalHelpersSrc).toMatch(/await claimConversationsForCustomer\(cred\.user\.uid,\s*email\)/);
  });

  it("claimConversationsForCustomer only stamps docs that have no customerUid yet", () => {
    expect(portalHelpersSrc).toMatch(/where\(\s*["']customerEmail["'],\s*"==",\s*target\s*\)/);
    expect(portalHelpersSrc).toMatch(/if\s*\(!data\.customerUid\)/);
    expect(portalHelpersSrc).toMatch(/customerUid:\s*uid/);
  });
});
