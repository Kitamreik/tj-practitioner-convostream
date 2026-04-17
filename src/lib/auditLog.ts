/**
 * Lightweight client-side audit logging.
 *
 * We persist meaningful CRUD events to dedicated Firestore collections so the
 * Audit Logs page can render them in real time. Failures are logged and swallowed —
 * audit logging must never block the user-facing action.
 */
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sanitizeText } from "@/lib/validation";

export type NoteAuditAction = "create" | "edit" | "delete" | "mark_read";

export interface NoteAuditEntry {
  action: NoteAuditAction;
  /** message | call | alert */
  type: string;
  title: string;
  description?: string;
  /** Display name of the actor (best-effort; may be "Unknown"). */
  actor: string;
}

export async function logNoteAudit(entry: NoteAuditEntry): Promise<void> {
  try {
    await addDoc(collection(db, "noteAudit"), {
      action: entry.action,
      type: sanitizeText(entry.type).slice(0, 32),
      title: sanitizeText(entry.title).slice(0, 200),
      description: sanitizeText(entry.description || "").slice(0, 500),
      actor: sanitizeText(entry.actor || "Unknown").slice(0, 80),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("noteAudit write failed:", err);
  }
}

export interface PeopleAuditEntry {
  /** Doc id of the new person (or "local" for fallback mode). */
  personId: string;
  name: string;
  email?: string;
  phone?: string;
  actor: string;
}

export async function logPersonCreated(entry: PeopleAuditEntry): Promise<void> {
  try {
    await addDoc(collection(db, "peopleAudit"), {
      personId: entry.personId,
      name: sanitizeText(entry.name).slice(0, 80),
      email: sanitizeText(entry.email || "").slice(0, 254),
      phone: sanitizeText(entry.phone || "").slice(0, 32),
      actor: sanitizeText(entry.actor || "Unknown").slice(0, 80),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("peopleAudit write failed:", err);
  }
}
