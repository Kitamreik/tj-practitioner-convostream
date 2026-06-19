/**
 * Webmaster-only demo data seeder.
 *
 * Writes realistic sample documents into Firestore so the
 *   - Escalation requests panel
 *   - Pending signup approvals panel
 *   - Investigation requests queue
 * always have data to render in fresh environments / preview deploys.
 *
 * Every seed doc carries `seedDemo: true` so it can be located and removed
 * later, and uses deterministic ids (`seed-*`) so re-running the seeder is
 * idempotent.
 *
 * Also exposes `deleteAllCustomerAccounts`, which iterates every
 * users/{uid} doc with role === "customer" and calls the
 * `deleteUserAccount` callable to fully remove them (Auth row + Firestore
 * profile). Webmaster only — the server-side rule enforces this too.
 */
import {
  collection,
  getDocs,
  query,
  setDoc,
  doc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

const SEED_FLAG = { seedDemo: true } as const;

interface SeedActor {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export interface SeedSummary {
  escalations: number;
  signups: number;
  investigations: number;
  customers: number;
}


/** Idempotent: uses fixed seed-* ids so re-runs overwrite cleanly. */
export async function seedEscalationRequests(actor: SeedActor): Promise<number> {
  const rows = [
    {
      id: "seed-escalation-pending",
      requesterUid: actor.uid,
      requesterEmail: actor.email ?? null,
      requesterName: actor.displayName ?? "Demo Admin",
      requesterRole: "admin",
      requestType: "access-grant",
      reason:
        "Need temporary escalated access to review the integrations dashboard during this evening's incident review.",
      status: "pending",
    },
    {
      id: "seed-escalation-approved",
      requesterUid: actor.uid,
      requesterEmail: actor.email ?? null,
      requesterName: actor.displayName ?? "Demo Admin",
      requesterRole: "admin",
      requestType: "role-promotion",
      targetIdentifier: "team-lead@convohub.dev",
      reason: "Promote rotating on-call team lead to webmaster for the week.",
      status: "approved",
    },
    {
      id: "seed-escalation-denied",
      requesterUid: actor.uid,
      requesterEmail: actor.email ?? null,
      requesterName: actor.displayName ?? "Demo Admin",
      requesterRole: "agent",
      requestType: "access-grant",
      reason: "Asked for production analytics — out of scope for the agent role.",
      status: "denied",
    },
  ];

  await Promise.all(
    rows.map((r) =>
      setDoc(
        doc(db, "escalationRequests", r.id),
        { ...r, ...SEED_FLAG, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      )
    )
  );
  return rows.length;
}

export async function seedPendingSignups(): Promise<number> {
  const rows = [
    {
      uid: "seed-signup-pending-1",
      email: "alex.morgan@convohub.dev",
      displayName: "Alex Morgan",
      role: "agent",
      approvalStatus: "pending",
      rosterMatch: { matched: true, entryId: "seed-roster-1", matchedOn: "email" },
    },
    {
      uid: "seed-signup-pending-2",
      email: "jamie.lee@convohub.dev",
      displayName: "Jamie Lee",
      role: "agent",
      approvalStatus: "pending",
      rosterMatch: { matched: false },
    },
    {
      uid: "seed-signup-pending-3",
      email: "priya.shah@convohub.dev",
      displayName: "Priya Shah",
      role: "agent",
      approvalStatus: "pending",
      rosterMatch: { matched: true, entryId: "seed-roster-2", matchedOn: "displayName" },
    },
  ];

  await Promise.all(
    rows.map((r) =>
      setDoc(
        doc(db, "users", r.uid),
        { ...r, ...SEED_FLAG, createdAt: serverTimestamp() },
        { merge: true }
      )
    )
  );
  return rows.length;
}

export async function seedInvestigationRequests(actor: SeedActor): Promise<number> {
  const rows = [
    {
      id: "seed-investigation-open",
      kind: "signup_verification",
      reason: "Display name did not match the agent roster — manual review requested.",
      requesterUid: actor.uid,
      requesterEmail: actor.email ?? null,
      targetEmail: "jamie.lee@convohub.dev",
      targetDisplayName: "Jamie Lee",
      status: "open",
    },
    {
      id: "seed-investigation-resolved",
      kind: "signup_verification",
      reason: "Confirmed via Slack DM; account approved.",
      requesterUid: actor.uid,
      requesterEmail: actor.email ?? null,
      targetEmail: "alex.morgan@convohub.dev",
      targetDisplayName: "Alex Morgan",
      status: "resolved",
    },
  ];

  await Promise.all(
    rows.map((r) =>
      setDoc(
        doc(db, "investigationRequests", r.id),
        { ...r, ...SEED_FLAG, createdAt: serverTimestamp() },
        { merge: true }
      )
    )
  );
  return rows.length;
}

/**
 * Idempotent pending customer signups so admins/webmasters can practice
 * approving customer accounts without needing a real Firebase Auth user.
 * These rows have role="customer" and `approvalStatus: "pending"` so they
 * appear in the SignupApprovalsPanel alongside agent signups.
 */
export async function seedPendingCustomerSignups(): Promise<number> {
  const rows = [
    {
      uid: "seed-customer-pending-1",
      email: "river.nguyen@example.com",
      displayName: "River Nguyen",
      role: "customer",
      approvalStatus: "pending",
      signupSource: "portal-signup",
    },
    {
      uid: "seed-customer-pending-2",
      email: "morgan.silva@example.com",
      displayName: "Morgan Silva",
      role: "customer",
      approvalStatus: "pending",
      signupSource: "portal-signup",
    },
  ];
  await Promise.all(
    rows.map((r) =>
      setDoc(
        doc(db, "users", r.uid),
        { ...r, ...SEED_FLAG, createdAt: serverTimestamp() },
        { merge: true }
      )
    )
  );
  return rows.length;
}

export async function seedAllDemoData(actor: SeedActor): Promise<SeedSummary> {
  const [escalations, signups, investigations, customers] = await Promise.all([
    seedEscalationRequests(actor),
    seedPendingSignups(),
    seedInvestigationRequests(actor),
    seedPendingCustomerSignups(),
  ]);
  return { escalations, signups, investigations, customers };
}


/**
 * Delete every users/{uid} doc with role === "customer" (and their Firebase
 * Auth row) via the webmaster-only `deleteUserAccount` callable.
 * Returns the list of uids that were deleted plus any failures.
 */
export async function deleteAllCustomerAccounts(callerUid: string): Promise<{
  deleted: string[];
  failures: { uid: string; error: string }[];
}> {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "customer")));
  const fn = httpsCallable<{ targetUid: string }, { ok: boolean }>(functions, "deleteUserAccount");
  const deleted: string[] = [];
  const failures: { uid: string; error: string }[] = [];
  for (const d of snap.docs) {
    if (d.id === callerUid) continue; // safety — never delete self
    try {
      await fn({ targetUid: d.id });
      deleted.push(d.id);
    } catch (err) {
      failures.push({ uid: d.id, error: (err as { message?: string }).message ?? String(err) });
    }
  }
  return { deleted, failures };
}
