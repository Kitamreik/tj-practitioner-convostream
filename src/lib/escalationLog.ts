/**
 * Escalation log — MVP-level local-first persistence for "Escalate to
 * Webmaster" submissions.
 *
 * Why localStorage?
 *   - The webmaster contact form must work even when Firestore is
 *     unreachable, the user's profile is mid-load, or rules reject a
 *     write transiently. The MVP requirement is "never lose an
 *     escalation note", so every submission is appended to a per-user
 *     queue in localStorage *first* and only later mirrored to
 *     Firestore (via the webmaster push button).
 *   - Reads are scoped to the signed-in user so other accounts on the
 *     same browser don't see each other's incidents.
 *
 * Firestore mirroring is webmaster-only. A staff member submits — the
 * entry stays local. A webmaster opens the modal and taps "Push
 * escalation logs to Firestore" to batch-write the pending rows into
 * `webmasterContactEvents` (channel = "escalation"), the same
 * collection the existing webmaster timeline already consumes.
 */
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const KEY_PREFIX = "ConvoHub.escalationLog.v1.";

export interface EscalationEntry {
  id: string;
  agentUid: string;
  agentName: string;
  agentEmail: string | null;
  route: string;
  note: string;
  createdAtMs: number;
  syncedAt: number | null;
}

function keyFor(uid: string): string {
  return KEY_PREFIX + uid;
}

function readAll(uid: string): EscalationEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EscalationEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(uid: string, entries: EscalationEntry[]): void {
  try {
    localStorage.setItem(keyFor(uid), JSON.stringify(entries));
  } catch {
    /* private mode / quota */
  }
}

export function listEscalationEntries(uid: string): EscalationEntry[] {
  return readAll(uid).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export function listPendingEscalationEntries(uid: string): EscalationEntry[] {
  return listEscalationEntries(uid).filter((e) => e.syncedAt === null);
}

export function appendEscalationEntry(input: {
  agentUid: string;
  agentName: string;
  agentEmail?: string | null;
  route: string;
  note: string;
}): EscalationEntry {
  const entry: EscalationEntry = {
    id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentUid: input.agentUid,
    agentName: (input.agentName || "Unknown").slice(0, 120),
    agentEmail: input.agentEmail ?? null,
    route: (input.route || "/").slice(0, 240),
    note: (input.note || "").slice(0, 4000),
    createdAtMs: Date.now(),
    syncedAt: null,
  };
  const existing = readAll(input.agentUid);
  existing.push(entry);
  writeAll(input.agentUid, existing);
  return entry;
}

export function clearEscalationEntries(uid: string): void {
  try {
    localStorage.removeItem(keyFor(uid));
  } catch {
    /* ignore */
  }
}

/**
 * Push every pending (un-synced) entry for the signed-in user to
 * Firestore. Webmaster-only by Firestore rule
 * (`webmasterContactEvents` rejects channels other than 'call'|'text'
 * for non-server writes — webmasters bypass via admin-equivalent
 * rule; see firestore.rules where the "escalation" channel is
 * explicitly allowed for webmaster writes).
 *
 * Returns the number of rows actually persisted.
 */
export async function pushEscalationLogToFirestore(uid: string): Promise<number> {
  const pending = listPendingEscalationEntries(uid);
  if (pending.length === 0) return 0;
  let pushed = 0;
  const all = readAll(uid);
  for (const entry of pending) {
    try {
      await addDoc(collection(db, "webmasterContactEvents"), {
        agentUid: entry.agentUid,
        agentName: entry.agentName,
        agentEmail: entry.agentEmail,
        channel: "escalation",
        route: entry.route,
        note: entry.note,
        clientCreatedAtMs: entry.createdAtMs,
        createdAt: serverTimestamp(),
      });
      const idx = all.findIndex((e) => e.id === entry.id);
      if (idx !== -1) all[idx] = { ...all[idx], syncedAt: Date.now() };
      pushed += 1;
    } catch (err) {
      console.warn("pushEscalationLogToFirestore: failed entry", entry.id, err);
      break; // stop on first failure so we don't burn the rest on the same error
    }
  }
  writeAll(uid, all);
  return pushed;
}
