/**
 * Archive queue helpers.
 *
 * - `archiveCustomer(uid, reason, actor)` writes an entry to the
 *   `archivedCustomers` Firestore collection and marks the user's profile
 *   doc as archived. The required `reason` is persisted alongside actor
 *   metadata so the Archive page can render a documented note.
 * - `archiveAgent(...)` does the same for agents (both Firestore-backed
 *   agents and local-only roster entries) into `archivedAgents`.
 * - `restoreArchivedCustomer` / `restoreArchivedAgent` flip the archive
 *   flag off and remove the archive doc.
 *
 * The Archive page reads these two collections (admin/webmaster only) and
 * renders them in line with archived conversations.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface ArchiveActor {
  uid?: string;
  displayName?: string;
  email?: string;
  role?: string;
}

export interface ArchiveCustomerInput {
  uid: string;
  email?: string;
  displayName?: string;
  reason: string;
  actor: ArchiveActor;
}

export interface ArchiveAgentInput {
  /** Firestore uid OR local agent id (e.g. "local:agent@example.com"). */
  id: string;
  email?: string;
  displayName?: string;
  /** True when the entry is from the local roster (no Firestore user doc). */
  isLocal?: boolean;
  reason: string;
  actor: ArchiveActor;
}

function trimmedReason(reason: string): string {
  const r = (reason || "").trim();
  if (!r) throw new Error("A documented reason is required to archive.");
  if (r.length > 1000) return r.slice(0, 1000);
  return r;
}

export async function archiveCustomer(input: ArchiveCustomerInput): Promise<void> {
  const reason = trimmedReason(input.reason);
  await addDoc(collection(db, "archivedCustomers"), {
    customerUid: input.uid,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    reason,
    archivedAt: serverTimestamp(),
    archivedByUid: input.actor.uid ?? null,
    archivedByName: input.actor.displayName ?? input.actor.email ?? "Unknown",
    archivedByRole: input.actor.role ?? null,
  });
  // Best-effort mark on the user profile so role-gated UI hides them.
  try {
    await updateDoc(doc(db, "users", input.uid), {
      archived: true,
      archivedAt: serverTimestamp(),
      archiveReason: reason,
    });
  } catch (err) {
    console.warn("archiveCustomer: profile update failed", err);
  }
}

export async function archiveAgent(input: ArchiveAgentInput): Promise<void> {
  const reason = trimmedReason(input.reason);
  await addDoc(collection(db, "archivedAgents"), {
    agentId: input.id,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    isLocal: !!input.isLocal,
    reason,
    archivedAt: serverTimestamp(),
    archivedByUid: input.actor.uid ?? null,
    archivedByName: input.actor.displayName ?? input.actor.email ?? "Unknown",
    archivedByRole: input.actor.role ?? null,
  });
  if (!input.isLocal) {
    try {
      await updateDoc(doc(db, "users", input.id), {
        archived: true,
        archivedAt: serverTimestamp(),
        archiveReason: reason,
      });
    } catch (err) {
      console.warn("archiveAgent: profile update failed", err);
    }
  }
}

export async function restoreArchivedCustomer(docId: string, customerUid: string): Promise<void> {
  await deleteDoc(doc(db, "archivedCustomers", docId));
  try {
    await updateDoc(doc(db, "users", customerUid), {
      archived: false,
      archivedAt: null,
      archiveReason: null,
    });
  } catch {
    /* non-fatal */
  }
}

export async function restoreArchivedAgent(
  docId: string,
  agentId: string,
  isLocal: boolean,
): Promise<void> {
  await deleteDoc(doc(db, "archivedAgents", docId));
  if (!isLocal) {
    try {
      await updateDoc(doc(db, "users", agentId), {
        archived: false,
        archivedAt: null,
        archiveReason: null,
      });
    } catch {
      /* non-fatal */
    }
  }
}
