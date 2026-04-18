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

/**
 * Audit entry for a newly-created agent. Persisted to the `peopleAudit`
 * collection (kept for backward compatibility — the same Firestore rules
 * already apply) but rendered on the Audit Logs page as "New Agents".
 *
 * `source` distinguishes how the agent entered the roster:
 *   - "manual" — webmaster used the "Add agent" dialog (local roster only)
 *   - "invite" — webmaster generated a signup link via the invite dialog
 */
export interface AgentAuditEntry {
  /** Stable id (local:<email> for manual adds, uid for invites). */
  personId: string;
  name: string;
  email?: string;
  source: "manual" | "invite";
  actor: string;
}

export async function logAgentCreated(entry: AgentAuditEntry): Promise<void> {
  try {
    await addDoc(collection(db, "peopleAudit"), {
      personId: entry.personId,
      name: sanitizeText(entry.name).slice(0, 80),
      email: sanitizeText(entry.email || "").slice(0, 254),
      // `phone` retained as empty string so existing AuditLogs readers don't
      // crash on undefined; semantically agents don't carry phone numbers.
      phone: "",
      source: entry.source === "invite" ? "invite" : "manual",
      actor: sanitizeText(entry.actor || "Unknown").slice(0, 80),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("agentAudit write failed:", err);
  }
}
