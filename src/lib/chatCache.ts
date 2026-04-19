/**
 * localStorage failsafe for Team Chat.
 *
 * Why: Firestore is the source of truth, but there are two cases where the
 * UI should still render something useful:
 *   1. The user is offline / reconnecting — Firestore returns an empty
 *      snapshot until it reconnects, which would otherwise blank out the
 *      thread list and any open conversation.
 *   2. The user just navigated to /chat and the listener hasn't replayed
 *      the cached query yet — without this layer the list flashes empty
 *      for ~200-500ms even on warm sessions.
 *
 * Design notes:
 *   - Scoped per-uid so two accounts on the same browser don't bleed into
 *     each other.
 *   - Stores the *serialized* shape of each ChatThread / ChatMessage —
 *     Firestore Timestamps are flattened to `{ _ms: number }` and rebuilt
 *     to a Timestamp-shaped object with `.toMillis()` and `.toDate()` so
 *     existing call sites that do `t.lastMessageAt?.toMillis?.()` keep
 *     working without a code change.
 *   - Write-through on every Firestore snapshot — never block the UI on
 *     localStorage; failures are logged and ignored.
 *   - Best-effort: if localStorage throws (private mode, quota), the chat
 *     still works exactly as before — the failsafe just becomes a no-op.
 */

import { Timestamp } from "firebase/firestore";
import type { ChatMessage, ChatThread } from "@/lib/chat";

const THREADS_KEY = (uid: string) => `convohub.chat.threads.v1.${uid}`;
const MESSAGES_KEY = (uid: string, threadId: string) =>
  `convohub.chat.messages.v1.${uid}.${threadId}`;

/** Per-uid cap so a chatty account doesn't blow past the ~5MB quota. */
const MAX_THREADS_CACHED = 100;
/** Keep the most recent N messages per thread — enough for the visible scroll
 * window on first paint; the live listener fills in the rest. */
const MAX_MESSAGES_CACHED = 200;

interface SerializedTimestamp {
  _ms: number;
}
interface CachedThread extends Omit<ChatThread, "createdAt" | "updatedAt" | "lastMessageAt" | "readState" | "typingState"> {
  createdAt: SerializedTimestamp | null;
  updatedAt: SerializedTimestamp | null;
  lastMessageAt: SerializedTimestamp | null;
  readState: Record<string, SerializedTimestamp> | null;
  typingState: Record<string, SerializedTimestamp> | null;
}
interface CachedMessage extends Omit<ChatMessage, "createdAt" | "editedAt" | "deletedAt"> {
  createdAt: SerializedTimestamp | null;
  editedAt: SerializedTimestamp | null;
  deletedAt: SerializedTimestamp | null;
}

// ---------- (de)serialization helpers ---------------------------------------

function serializeTs(ts: any): SerializedTimestamp | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") {
    try {
      return { _ms: ts.toMillis() };
    } catch {
      return null;
    }
  }
  if (typeof ts._ms === "number") return { _ms: ts._ms };
  return null;
}

/** Build a Timestamp-shaped object whose `.toMillis()` / `.toDate()` work
 * exactly like a real Firestore Timestamp so call sites don't have to
 * branch on cache-vs-live. */
function rehydrateTs(s: SerializedTimestamp | null | undefined): Timestamp | null {
  if (!s || typeof s._ms !== "number") return null;
  // Use the real Timestamp class so identity checks (instanceof) keep working.
  return Timestamp.fromMillis(s._ms);
}

function serializeMap(
  m: Record<string, any> | undefined | null
): Record<string, SerializedTimestamp> | null {
  if (!m) return null;
  const out: Record<string, SerializedTimestamp> = {};
  for (const [k, v] of Object.entries(m)) {
    const s = serializeTs(v);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

function rehydrateMap(
  m: Record<string, SerializedTimestamp> | null | undefined
): Record<string, Timestamp> | undefined {
  if (!m) return undefined;
  const out: Record<string, Timestamp> = {};
  for (const [k, v] of Object.entries(m)) {
    const ts = rehydrateTs(v);
    if (ts) out[k] = ts;
  }
  return Object.keys(out).length ? out : undefined;
}

function serializeThread(t: ChatThread): CachedThread {
  return {
    ...t,
    createdAt: serializeTs(t.createdAt),
    updatedAt: serializeTs(t.updatedAt),
    lastMessageAt: serializeTs(t.lastMessageAt),
    readState: serializeMap(t.readState),
    typingState: serializeMap(t.typingState),
  };
}

function rehydrateThread(t: CachedThread): ChatThread {
  return {
    ...t,
    createdAt: rehydrateTs(t.createdAt),
    updatedAt: rehydrateTs(t.updatedAt),
    lastMessageAt: rehydrateTs(t.lastMessageAt),
    readState: rehydrateMap(t.readState),
    typingState: rehydrateMap(t.typingState),
  };
}

function serializeMessage(m: ChatMessage): CachedMessage {
  return {
    ...m,
    createdAt: serializeTs(m.createdAt),
    editedAt: serializeTs(m.editedAt),
    deletedAt: serializeTs(m.deletedAt),
  };
}

function rehydrateMessage(m: CachedMessage): ChatMessage {
  return {
    ...m,
    createdAt: rehydrateTs(m.createdAt),
    editedAt: rehydrateTs(m.editedAt),
    deletedAt: rehydrateTs(m.deletedAt),
  };
}

// ---------- public API ------------------------------------------------------

/** Returns the cached threads for `uid`, or [] if cache is empty/unavailable. */
export function loadCachedThreads(uid: string): ChatThread[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(THREADS_KEY(uid));
    if (!raw) return [];
    const arr = JSON.parse(raw) as CachedThread[];
    if (!Array.isArray(arr)) return [];
    return arr.map(rehydrateThread);
  } catch (err) {
    console.warn("loadCachedThreads failed:", err);
    return [];
  }
}

/** Write-through cache update from a live Firestore snapshot. */
export function saveCachedThreads(uid: string, threads: ChatThread[]): void {
  if (!uid) return;
  try {
    const trimmed = threads.slice(0, MAX_THREADS_CACHED).map(serializeThread);
    localStorage.setItem(THREADS_KEY(uid), JSON.stringify(trimmed));
  } catch (err) {
    console.warn("saveCachedThreads failed:", err);
  }
}

export function loadCachedMessages(uid: string, threadId: string): ChatMessage[] {
  if (!uid || !threadId) return [];
  try {
    const raw = localStorage.getItem(MESSAGES_KEY(uid, threadId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as CachedMessage[];
    if (!Array.isArray(arr)) return [];
    return arr.map(rehydrateMessage);
  } catch (err) {
    console.warn("loadCachedMessages failed:", err);
    return [];
  }
}

export function saveCachedMessages(
  uid: string,
  threadId: string,
  messages: ChatMessage[]
): void {
  if (!uid || !threadId) return;
  try {
    // Keep only the tail — oldest get evicted first.
    const tail = messages.slice(-MAX_MESSAGES_CACHED).map(serializeMessage);
    localStorage.setItem(MESSAGES_KEY(uid, threadId), JSON.stringify(tail));
  } catch (err) {
    console.warn("saveCachedMessages failed:", err);
  }
}

/**
 * Optimistically append a not-yet-persisted message to the cache so the
 * sender sees their bubble immediately and it survives a hard reload before
 * Firestore confirms the write. The id is prefixed with "local-" so we can
 * tell it apart from server ids and de-dupe later when the snapshot arrives.
 */
export function appendOptimisticMessage(
  uid: string,
  threadId: string,
  partial: Omit<ChatMessage, "id" | "createdAt"> & { createdAtMs?: number }
): ChatMessage {
  const optimistic: ChatMessage = {
    ...partial,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Timestamp.fromMillis(partial.createdAtMs ?? Date.now()),
  };
  const existing = loadCachedMessages(uid, threadId);
  saveCachedMessages(uid, threadId, [...existing, optimistic]);
  return optimistic;
}

/** Remove all chat caches for `uid` (e.g. on sign-out). */
export function clearCachedChat(uid: string): void {
  if (!uid) return;
  try {
    const prefix = `convohub.chat.`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k.endsWith(`.${uid}`)) toRemove.push(k);
      else if (k && k.startsWith(prefix) && k.includes(`.${uid}.`)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.warn("clearCachedChat failed:", err);
  }
}

/**
 * Merge live Firestore messages with any optimistic local-only messages
 * already in cache for the same thread. Used by `subscribeThreadMessages`
 * so a freshly-sent message that hasn't echoed back yet stays visible.
 *
 * - Server messages always win when ids match.
 * - Local-only messages whose body matches a server message within a 30s
 *   window are dropped (the server version superseded them).
 */
export function mergeWithOptimistic(
  uid: string,
  threadId: string,
  serverMessages: ChatMessage[]
): ChatMessage[] {
  if (!uid || !threadId) return serverMessages;
  const cached = loadCachedMessages(uid, threadId);
  const localOnly = cached.filter((m) => m.id.startsWith("local-"));
  if (localOnly.length === 0) return serverMessages;
  const FRESH_WINDOW_MS = 30_000;
  const stillPending = localOnly.filter((local) => {
    const localMs = local.createdAt?.toMillis?.() ?? 0;
    return !serverMessages.some((s) => {
      if (s.senderUid !== local.senderUid) return false;
      if (s.body !== local.body) return false;
      const sMs = s.createdAt?.toMillis?.() ?? 0;
      return Math.abs(sMs - localMs) < FRESH_WINDOW_MS;
    });
  });
  if (stillPending.length === 0) return serverMessages;
  return [...serverMessages, ...stillPending].sort((a, b) => {
    const am = a.createdAt?.toMillis?.() ?? 0;
    const bm = b.createdAt?.toMillis?.() ?? 0;
    return am - bm;
  });
}
