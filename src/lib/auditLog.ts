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
 * Audit entries for the agent lifecycle. All write to the `peopleAudit`
 * collection so the AuditLogs "Agent Activity" tab can render the full
 * history (create + remove + role changes) in one timeline.
 *
 * `action` distinguishes the event:
 *   - "create"      — agent added (manual roster entry or invite-created auth user)
 *   - "remove"      — local roster entry removed by webmaster
 *   - "role_change" — Firestore user role flipped (agent ⇄ admin)
 *
 * `source` is only meaningful for "create" rows but kept on every entry for
 * a stable schema. Legacy rows without an `action` field are treated as
 * "create" by the reader for backward compatibility.
 */
export type AgentAuditAction = "create" | "remove" | "role_change";

export interface AgentAuditEntry {
  /** Stable id (local:<email> for manual adds, uid for invites/role changes). */
  personId: string;
  name: string;
  email?: string;
  source: "manual" | "invite";
  actor: string;
}

export async function logAgentCreated(entry: AgentAuditEntry): Promise<void> {
  try {
    await addDoc(collection(db, "peopleAudit"), {
      action: "create",
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

export interface AgentRemovalEntry {
  personId: string;
  name: string;
  email?: string;
  /** Where the removal happened — currently only "manual" (local roster). */
  source: "manual";
  actor: string;
}

export async function logAgentRemoved(entry: AgentRemovalEntry): Promise<void> {
  try {
    await addDoc(collection(db, "peopleAudit"), {
      action: "remove",
      personId: entry.personId,
      name: sanitizeText(entry.name).slice(0, 80),
      email: sanitizeText(entry.email || "").slice(0, 254),
      phone: "",
      source: entry.source,
      actor: sanitizeText(entry.actor || "Unknown").slice(0, 80),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("agentRemoval audit write failed:", err);
  }
}

export interface AgentRoleChangeEntry {
  personId: string;
  name: string;
  email?: string;
  fromRole: "agent" | "admin" | "webmaster";
  toRole: "agent" | "admin" | "webmaster";
  actor: string;
}

export async function logAgentRoleChanged(entry: AgentRoleChangeEntry): Promise<void> {
  try {
    await addDoc(collection(db, "peopleAudit"), {
      action: "role_change",
      personId: entry.personId,
      name: sanitizeText(entry.name).slice(0, 80),
      email: sanitizeText(entry.email || "").slice(0, 254),
      phone: "",
      // For role changes, `source` carries the transition (e.g. "agent→admin")
      // so the existing reader doesn't need a schema migration.
      source: `${entry.fromRole}→${entry.toRole}`,
      fromRole: entry.fromRole,
      toRole: entry.toRole,
      actor: sanitizeText(entry.actor || "Unknown").slice(0, 80),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("agentRoleChange audit write failed:", err);
  }
}
