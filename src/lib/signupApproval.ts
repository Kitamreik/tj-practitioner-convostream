/**
 * Signup approval gate + investigation queue.
 *
 * Every new account is created with approvalStatus = "pending" on the
 * `users/{uid}` profile. Webmasters and admins can approve or reject from
 * Settings → Pending approvals. Unapproved users are routed to the
 * /pending-approval landing page by App.tsx.
 *
 * When a signup is rejected (or the displayName doesn't match the agent
 * roster and an admin requests an investigation), the form data and a
 * captured screenshot are pushed into `investigationRequests`. If the
 * Firestore write fails (e.g. permission denied, offline), the payload is
 * persisted to localStorage so a webmaster can recover it later.
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const APPROVALS_LOCAL_KEY = "KitTJ.pendingInvestigations.v1";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingSignup {
  uid: string;
  email: string;
  displayName: string;
  approvalStatus: ApprovalStatus;
  rosterMatch?: {
    matched: boolean;
    entryId?: string;
    matchedOn?: string;
  };
  createdAt?: { toDate?: () => Date } | null;
  approvedAt?: { toDate?: () => Date } | null;
  approvedByUid?: string | null;
  rejectionNote?: string;
}

export interface InvestigationRequest {
  id: string;
  kind: "signup_verification";
  reason: string;
  requesterUid: string;
  requesterEmail?: string | null;
  targetEmail: string;
  targetDisplayName: string;
  screenshotDataUrl?: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt?: { toDate?: () => Date } | null;
}

/** Subscribe to pending signups (webmaster + admin only by rules). */
export function subscribePendingSignups(
  cb: (rows: PendingSignup[]) => void
): () => void {
  const q = query(
    collection(db, "users"),
    where("approvalStatus", "==", "pending")
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as Omit<PendingSignup, "uid">;
        return { uid: d.id, ...data };
      });
      cb(rows);
    },
    (err) => {
      console.warn("subscribePendingSignups error:", err);
      cb([]);
    }
  );
}

export async function approveSignup(
  uid: string,
  approverUid: string
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    approvalStatus: "approved",
    approvedAt: serverTimestamp(),
    approvedByUid: approverUid,
  });
}

export async function rejectSignup(
  uid: string,
  approverUid: string,
  note?: string
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    approvalStatus: "rejected",
    approvedAt: serverTimestamp(),
    approvedByUid: approverUid,
    rejectionNote: (note ?? "").slice(0, 500),
  });
}

interface InvestigationPayload {
  reason: string;
  requesterUid: string;
  requesterEmail?: string | null;
  targetEmail: string;
  targetDisplayName: string;
  screenshotDataUrl?: string | null;
}

/**
 * Push a signup-verification investigation request. Falls back to
 * localStorage on Firestore failure so the payload isn't lost.
 */
export async function createSignupInvestigation(
  payload: InvestigationPayload
): Promise<{ ok: true; id: string } | { ok: false; fellBack: true; error: string }> {
  try {
    const ref = await addDoc(collection(db, "investigationRequests"), {
      kind: "signup_verification",
      reason: payload.reason.slice(0, 500),
      requesterUid: payload.requesterUid,
      requesterEmail: payload.requesterEmail ?? null,
      targetEmail: payload.targetEmail.slice(0, 240),
      targetDisplayName: payload.targetDisplayName.slice(0, 120),
      screenshotDataUrl: payload.screenshotDataUrl ?? null,
      status: "open",
      createdAt: serverTimestamp(),
    });
    return { ok: true, id: ref.id };
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    // Local fallback so the webmaster doesn't lose the payload.
    persistInvestigationLocally({
      ...payload,
      _localId: `local:${Date.now()}`,
      _persistedAt: new Date().toISOString(),
    });
    return { ok: false, fellBack: true, error: msg };
  }
}

interface LocalInvestigation extends InvestigationPayload {
  _localId: string;
  _persistedAt: string;
}

function persistInvestigationLocally(entry: LocalInvestigation): void {
  try {
    const raw = localStorage.getItem(APPROVALS_LOCAL_KEY);
    const arr: LocalInvestigation[] = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    // Cap to most recent 25 to avoid runaway quota.
    localStorage.setItem(APPROVALS_LOCAL_KEY, JSON.stringify(arr.slice(0, 25)));
  } catch {
    /* ignore */
  }
}

export function listLocalInvestigations(): LocalInvestigation[] {
  try {
    const raw = localStorage.getItem(APPROVALS_LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearLocalInvestigation(localId: string): void {
  try {
    const arr = listLocalInvestigations().filter((e) => e._localId !== localId);
    localStorage.setItem(APPROVALS_LOCAL_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/** Subscribe to signup-verification investigations. */
export function subscribeSignupInvestigations(
  cb: (rows: InvestigationRequest[]) => void
): () => void {
  const q = query(
    collection(db, "investigationRequests"),
    where("kind", "==", "signup_verification"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const data = d.data() as Omit<InvestigationRequest, "id">;
          return { id: d.id, ...data };
        })
      );
    },
    (err) => {
      console.warn("subscribeSignupInvestigations error:", err);
      cb([]);
    }
  );
}
