/**
 * End-to-end contract tests for the customer access boundary and the MVP
 * escalation log refactor.
 *
 * These tests are file-level contracts (no Firebase emulator) — they
 * lock in behaviour that is invisible to the type checker:
 *
 *   1. Customers cannot reach any staff route by direct navigation
 *      (ProtectedRoute redirects → /portal/chat).
 *   2. Firestore rules deny customers on every staff-only collection
 *      that backs the Gmail / agent-logs / call-analytics surfaces.
 *   3. PortalChat exposes the profile editor and `updateCustomerProfile`
 *      surfaces the `auth/requires-recent-login` error code without
 *      throwing — so the UI can show a friendly retry message.
 *   4. Rejected customers stay on the PortalPending screen and never
 *      reach /portal/chat. The seedDemoData helper supplies rejected
 *      rows so QA can reproduce the screen.
 *   5. The customer surface (PortalChat + portal route tree) does NOT
 *      reference Conversations / Gmail / agent-logs / call-analytics
 *      entry points in any form.
 *   6. Staff signup path stays wired to promoteToWebmaster /
 *      demoteAgent callables in Settings.
 *   7. EscalateWebmasterModal uses the new escalationLog helpers,
 *      logs to localStorage, and shows the webmaster-only Push button.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Customer access boundary", () => {
  it("ProtectedRoute redirects customers to /portal/chat (no staff route is reachable)", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/profile\?\.role\s*===\s*"customer"/);
    expect(app).toContain('Navigate to="/portal/chat"');
  });

  it("Gmail / Agent Logs / Call Analytics / Conversations live under the staff AppLayout gate", () => {
    const app = read("src/App.tsx");
    // Every staff route is mounted inside the AppLayout-wrapped ProtectedRoute,
    // which the redirect above guarantees customers can never enter.
    expect(app).toMatch(/path="\/gmail"/);
    expect(app).toMatch(/path="\/conversations"/);
    expect(app).toMatch(/path="\/call-analytics"/);
    // AppLayout itself is wrapped by <ProtectedRoute>.
    expect(app).toMatch(/<ProtectedRoute>\s*<AppLayout/);
  });

  it("Firestore rules deny customer writes to per-user integrations (Gmail/Slack/GV creds)", () => {
    const rules = read("firestore.rules");
    expect(rules).toMatch(
      /match \/users\/\{uid\}\/integrations\/\{credId\}[\s\S]*?allow read, write: if isSelf\(uid\) && !isCustomer\(\)/
    );
  });

  it("Firestore rules block customer reads on staff-only collections", () => {
    const rules = read("firestore.rules");
    // Audit logs (used by AgentLogs UI) require isInternal/isWebmaster.
    expect(rules).toMatch(/match \/peopleAudit\/\{id\}[\s\S]*?allow read: if isInternal/);
    expect(rules).toMatch(/match \/noteAudit\/\{id\}[\s\S]*?allow read: if isInternal/);
    // Call recordings (Call Analytics) — customers never match the agentUid path.
    expect(rules).toMatch(/match \/callRecordings\/\{id\}[\s\S]*?allow read: if isSignedIn\(\)\s*\n\s*&& \(resource\.data\.agentUid == request\.auth\.uid \|\| isAdmin\(\) \|\| isWebmaster\(\)\)/);
    // Conversations have a customer branch that requires customerUid match.
    expect(rules).toMatch(/match \/conversations\/\{convoId\}[\s\S]*?customerUid/);
  });

  it("Direct calls to Gmail-related endpoints are blocked for customers (not just UI)", () => {
    const rules = read("firestore.rules");
    // 1. The only Firestore-backed Gmail surface is the per-user
    //    integrations subcollection where the Gmail API key/clientId is
    //    persisted. Rule must require isSelf(uid) AND !isCustomer().
    expect(rules).toMatch(
      /match \/users\/\{uid\}\/integrations\/\{credId\}[\s\S]*?allow read, write: if isSelf\(uid\) && !isCustomer\(\)/
    );
    // 2. The shared integrations registry (used by GmailAPI.tsx to
    //    discover saved credentials) is gated to isInternal — customers
    //    can NEVER read or write it directly.
    expect(rules).toMatch(/match \/integrations\/\{id\}[\s\S]*?allow read, write: if isInternal/);
    // 3. The Gmail page itself is gated at the route layer by
    //    ProtectedRoute(escalated) — customers are redirected before
    //    GmailAPI.tsx (which holds the gapi.client.gmail calls) ever
    //    mounts. Confirm both layers are still in place.
    const app = read("src/App.tsx");
    expect(app).toMatch(/path="\/gmail"\s+element=\{<ProtectedRoute escalated><GmailAPI/);
    // 4. GmailAPI.tsx stores creds via saveIntegration → users/{uid}/integrations,
    //    which the rule above blocks for customers. Ensure the page still
    //    routes through the helper (rather than writing freehand).
    const gmailPage = read("src/pages/GmailAPI.tsx");
    expect(gmailPage).toMatch(/saveIntegration\(user\.uid,\s*"gmail-api"/);
  });
});

describe("Customer profile editing — requires-recent-login handling", () => {
  it("updateCustomerProfile reports the auth/requires-recent-login error code via emailError", () => {
    const lib = read("src/lib/customerPortal.ts");
    // The catch branch must surface `err.code` (where firebase puts
    // `auth/requires-recent-login`) before falling back to the message.
    expect(lib).toMatch(/emailError\s*=\s*\(err as[^}]*\}\)\.code/);
    expect(lib).toContain("updateEmail(user");
  });

  it("PortalChat hooks editName/editEmail state to the profile editor inputs", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).toContain('id="portal-edit-name"');
    expect(portal).toContain('id="portal-edit-email"');
    expect(portal).toContain("updateCustomerProfile");
  });
});

describe("Rejected customer signup flow", () => {
  it("CustomerRoute routes rejected customers to PortalPending (NEVER /portal/chat)", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/approvalStatus\s*&&\s*profile\.approvalStatus\s*!==\s*"approved"[\s\S]*?<PortalPending/);
    expect(app).toContain('status === "pending"');
  });

  it("PortalPending renders the rejection note from the profile", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/note\s*\|\|\s*"Please contact support/);
    expect(app).toMatch(/PortalPending: React\.FC<\{ status: "pending" \| "rejected"; note\?: string \}>/);
  });

  it("seedDemoData exposes seedRejectedCustomerSignups and includes rejectedCustomers in the summary", () => {
    const seed = read("src/lib/seedDemoData.ts");
    expect(seed).toContain("export async function seedRejectedCustomerSignups");
    expect(seed).toMatch(/approvalStatus:\s*"rejected"/);
    expect(seed).toContain("rejectionNote:");
    expect(seed).toMatch(/rejectedCustomers:\s*number/);
    expect(seed).toContain("seedRejectedCustomerSignups()");
  });
});

describe("Customer UI surfaces — Team Chat only", () => {
  it("PortalChat does not link to Conversations / Gmail / agent-logs / call-analytics", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).not.toMatch(/\/conversations/);
    expect(portal).not.toMatch(/\/gmail/);
    expect(portal).not.toMatch(/\/agent-logs/);
    expect(portal).not.toMatch(/\/call-analytics/);
    expect(portal).not.toMatch(/AgentLogs|CallAnalytics|GmailAPI/);
  });

  it("Customer portal route tree only mounts PortalChat / PortalThread under CustomerRoute", () => {
    const app = read("src/App.tsx");
    // The /portal/conversations path is a redirect, not a real route.
    expect(app).toMatch(/path="\/portal\/conversations"\s+element=\{<Navigate to="\/portal\/chat"/);
    // CustomerRoute wraps PortalChat and PortalThread.
    expect(app).toMatch(/<CustomerRoute><PortalChat \/><\/CustomerRoute>/);
  });

  it("AppSidebar/BottomNav (staff-only) are never rendered for the customer portal", () => {
    const portal = read("src/pages/portal/PortalChat.tsx");
    expect(portal).not.toContain("AppSidebar");
    expect(portal).not.toContain("BottomNav");
    expect(portal).not.toContain("AppLayout");
  });
});

describe("Staff signup → promote/demote wiring", () => {
  it("Settings still calls the promoteToWebmaster + demoteAgent callables", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toContain('"promoteToWebmaster"');
    expect(settings).toContain('"demoteAgent"');
    expect(settings).toMatch(/promoteAgentToAdmin\s*=\s*async/);
    expect(settings).toMatch(/demoteToAgent\s*=\s*async/);
  });

  it("Pending staff signups are surfaced through SignupApprovalsPanel", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toContain("SignupApprovalsPanel");
  });

  it("Firestore rules let admins+webmasters approve signups but block role tampering by self", () => {
    const rules = read("firestore.rules");
    // Self update cannot change role / escalatedAccess / approvalStatus.
    expect(rules).toMatch(/isSelf\(uid\)[\s\S]*?roleUnchanged\(\)[\s\S]*?escalatedAccessUnchanged\(\)/);
    expect(rules).toMatch(/isSelf\(uid\)[\s\S]*?approvalStatus/);
    // Admins / webmasters CAN.
    expect(rules).toMatch(/\|\|\s*isWebmaster\(\)\s*\n\s*\|\|\s*isAdmin\(\);/);
  });
});

describe("Escalate to Webmaster — MVP localStorage + push to Firestore", () => {
  it("escalationLog exposes append / list / pendingList / push helpers", () => {
    const lib = read("src/lib/escalationLog.ts");
    expect(lib).toContain("export function appendEscalationEntry");
    expect(lib).toContain("export function listEscalationEntries");
    expect(lib).toContain("export function listPendingEscalationEntries");
    expect(lib).toContain("export async function pushEscalationLogToFirestore");
    // Persists to localStorage under a scoped prefix.
    expect(lib).toContain("ConvoHub.escalationLog.v1.");
    // Pushes the queued entries into the existing webmasterContactEvents
    // collection (channel="escalation").
    expect(lib).toMatch(/collection\(db,\s*"webmasterContactEvents"\)/);
    expect(lib).toMatch(/channel:\s*"escalation"/);
  });

  it("Firestore rule permits the webmaster-only 'escalation' channel write", () => {
    const rules = read("firestore.rules");
    expect(rules).toMatch(/match \/webmasterContactEvents\/\{id\}[\s\S]*?isWebmaster\(\) && request\.resource\.data\.channel == 'escalation'/);
  });

  it("EscalateWebmasterModal logs to escalationLog and exposes the webmaster Push button", () => {
    const modal = read("src/components/EscalateWebmasterModal.tsx");
    expect(modal).toContain('from "@/lib/escalationLog"');
    expect(modal).toContain("appendEscalationEntry");
    expect(modal).toContain("pushEscalationLogToFirestore");
    // The Push button is gated to webmasters only.
    expect(modal).toMatch(/isWebmaster\s*=\s*profile\?\.role\s*===\s*"webmaster"/);
    expect(modal).toMatch(/\{isWebmaster\s*&&\s*\(/);
    // Customers are still hidden from the modal trigger entirely.
    expect(modal).toMatch(/profile\.role\s*===\s*"customer"/);
  });

  it("Escalate modal preserves the local draft + queue across reloads", () => {
    const modal = read("src/components/EscalateWebmasterModal.tsx");
    expect(modal).toContain("ConvoHub.webmasterEscalate.draft.");
    expect(modal).toMatch(/localStorage\.setItem\(draftKey/);
    expect(modal).toMatch(/localStorage\.getItem\(draftKey/);
  });
});

describe("Escalate log — automatic online retry", () => {
  it("escalationLog exports installEscalationOnlineRetry with the 'online' event handler", () => {
    const lib = read("src/lib/escalationLog.ts");
    expect(lib).toContain("export function installEscalationOnlineRetry");
    expect(lib).toMatch(/window\.addEventListener\("online"/);
    expect(lib).toMatch(/window\.removeEventListener\("online"/);
    // Guards against re-entrant pushes.
    expect(lib).toMatch(/let inflight = false/);
    // Kick a one-shot retry on install if already online.
    expect(lib).toMatch(/navigator\.onLine !== false/);
  });

  it("EscalateWebmasterModal installs the online retry while mounted", () => {
    const modal = read("src/components/EscalateWebmasterModal.tsx");
    expect(modal).toContain("installEscalationOnlineRetry");
    expect(modal).toMatch(/installEscalationOnlineRetry\(uid,/);
  });

  it("installEscalationOnlineRetry is a no-op without a pending queue", async () => {
    const mod = await import("@/lib/escalationLog");
    const uid = "test-no-pending-" + Math.random().toString(36).slice(2);
    let synced = 0;
    const teardown = mod.installEscalationOnlineRetry(uid, { onSynced: (n) => (synced += n) });
    // No pending entries → onSynced never fires.
    await new Promise((r) => setTimeout(r, 10));
    expect(synced).toBe(0);
    teardown();
  });

  it("appendEscalationEntry persists to localStorage and listPendingEscalationEntries returns it", async () => {
    const mod = await import("@/lib/escalationLog");
    const uid = "test-pending-" + Math.random().toString(36).slice(2);
    mod.appendEscalationEntry({
      agentUid: uid,
      agentName: "QA Agent",
      agentEmail: "qa@example.com",
      route: "/conversations",
      note: "Synthetic incident for retry test.",
    });
    const pending = mod.listPendingEscalationEntries(uid);
    expect(pending.length).toBe(1);
    expect(pending[0].note).toContain("Synthetic incident");
    expect(pending[0].syncedAt).toBeNull();
    mod.clearEscalationEntries(uid);
  });
});
