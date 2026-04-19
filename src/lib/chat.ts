/**
 * Internal team chat — Firestore helpers and types.
 *
 * Data model:
 *   chatThreads/{threadId}
 *     - participantUids: string[]      // exactly 2 entries (DM)
 *     - participantEmails: string[]
 *     - participantNames: string[]
 *     - createdByUid, createdAt, updatedAt
 *     - lastMessagePreview, lastMessageAt, lastMessageSenderUid
 *     - archived: boolean              // moderator-deleted threads
 *
 *   chatThreads/{threadId}/messages/{messageId}
 *     - senderUid, senderName, senderEmail
 *     - body, createdAt
 *     - editedAt: Timestamp | null
 *     - deleted: boolean, deletedByUid, deletedAt
 *
 * Soft-delete model: removing a bubble or thread sets `deleted: true` /
 * `archived: true` rather than hard-deleting, so the audit history stays
 * intact and a moderator can recover a thread by flipping the flag.
 *
 * Moderation = admin OR webmaster role, OR the special support@convohub.dev
 * account. Mirrored in firestore.rules via `isChatModerator()`.
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  appendOptimisticMessage,
  loadCachedMessages,
  loadCachedThreads,
  mergeWithOptimistic,
  saveCachedMessages,
  saveCachedThreads,
} from "@/lib/chatCache";

export const SUPPORT_EMAIL = "support@convohub.dev";

export interface ChatThread {
  id: string;
  participantUids: string[];
  participantEmails: string[];
  participantNames: string[];
  createdByUid: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastMessagePreview?: string;
  lastMessageAt?: Timestamp | null;
  lastMessageSenderUid?: string;
  archived?: boolean;
  /**
   * Per-participant read & typing state, keyed by uid:
   *   readState: { [uid]: Timestamp }     // when this user last opened the thread
   *   typingState: { [uid]: Timestamp }   // refreshed every few seconds while typing
   * Both kept on the thread doc itself so they ride the existing onSnapshot
   * subscription — no extra reads needed in the list view to compute unread.
   */
  readState?: Record<string, Timestamp>;
  typingState?: Record<string, Timestamp>;
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  senderName: string;
  senderEmail: string;
  body: string;
  createdAt?: Timestamp | null;
  editedAt?: Timestamp | null;
  deleted?: boolean;
  deletedByUid?: string;
  deletedAt?: Timestamp | null;
}

/** Deterministic DM thread id from two uids — sorted so order-independent. */
export function dmThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("__");
}

/**
 * Returns true if the given user can moderate (delete bubbles or threads).
 * Mirrors `isChatModerator()` in firestore.rules.
 */
export function canModerateChat(profile: {
  role?: string | null;
  email?: string | null;
  supportAccess?: boolean | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "webmaster") return true;
  if ((profile.email || "").trim().toLowerCase() === SUPPORT_EMAIL) return true;
  if (profile.supportAccess === true) return true;
  return false;
}

/**
 * Open (or create) a DM thread between two users. Idempotent — re-calling
 * with the same pair returns the existing thread. The thread doc is keyed
 * by sorted-uid pair so we never end up with two threads for one DM.
 */
export async function openOrCreateDmThread(args: {
  selfUid: string;
  selfEmail: string;
  selfName: string;
  otherUid: string;
  otherEmail: string;
  otherName: string;
}): Promise<string> {
  const id = dmThreadId(args.selfUid, args.otherUid);
  const ref = doc(db, "chatThreads", id);
  // setDoc with merge so the second caller doesn't clobber lastMessage*.
  await setDoc(
    ref,
    {
      participantUids: [args.selfUid, args.otherUid].sort(),
      participantEmails: [args.selfEmail, args.otherEmail],
      participantNames: [args.selfName, args.otherName],
      createdByUid: args.selfUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      archived: false,
    },
    { merge: true }
  );
  return id;
}

/**
 * Subscribe to all non-archived threads the user participates in. Sorted
 * client-side by lastMessageAt desc (Firestore can only order by one field
 * after a where clause without a composite index, and we want the simple
 * unindexed query path so this works on a fresh project).
 */
export function subscribeMyThreads(
  uid: string,
  cb: (threads: ChatThread[]) => void
): () => void {
  // 1) Hydrate from localStorage immediately so the UI never flashes empty
  //    while Firestore is still warming its connection / replaying cache.
  try {
    const cached = loadCachedThreads(uid);
    if (cached.length > 0) cb(cached);
  } catch {
    /* non-fatal */
  }

  const q = query(
    collection(db, "chatThreads"),
    where("participantUids", "array-contains", uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: ChatThread[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatThread, "id">) }))
        .filter((t) => !t.archived);
      rows.sort((a, b) => {
        const at = a.lastMessageAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bt = b.lastMessageAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      });
      // Write-through cache, then publish.
      saveCachedThreads(uid, rows);
      cb(rows);
    },
    (err) => {
      console.warn("subscribeMyThreads error:", err);
      // On error, keep showing the cache (don't blank the UI). If the cache
      // is also empty there's nothing more we can do.
      const cached = loadCachedThreads(uid);
      cb(cached);
    }
  );
}

/** Subscribe to messages in a thread, oldest first. */
export function subscribeThreadMessages(
  threadId: string,
  cb: (messages: ChatMessage[]) => void,
  /**
   * Caller's uid. Required for the localStorage failsafe (cache is
   * scoped per-user). Pass null to skip caching entirely.
   */
  selfUid: string | null = null
): () => void {
  // Hydrate from cache before the live snapshot arrives.
  if (selfUid) {
    try {
      const cached = loadCachedMessages(selfUid, threadId);
      if (cached.length > 0) cb(cached);
    } catch {
      /* non-fatal */
    }
  }

  const q = query(
    collection(db, "chatThreads", threadId, "messages"),
    orderBy("createdAt", "asc"),
    limit(500)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: ChatMessage[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatMessage, "id">),
      }));
      // Merge any still-pending optimistic local messages so a just-sent
      // bubble doesn't blink out while the server snapshot is in flight.
      const merged = selfUid ? mergeWithOptimistic(selfUid, threadId, rows) : rows;
      if (selfUid) saveCachedMessages(selfUid, threadId, merged);
      cb(merged);
    },
    (err) => {
      console.warn("subscribeThreadMessages error:", err);
      // Fall back to whatever the cache has so the user can still read prior history offline.
      if (selfUid) {
        const cached = loadCachedMessages(selfUid, threadId);
        cb(cached);
      } else {
        cb([]);
      }
    }
  );
}

export async function sendChatMessage(args: {
  threadId: string;
  senderUid: string;
  senderName: string;
  senderEmail: string;
  body: string;
}): Promise<void> {
  const trimmed = args.body.trim();
  if (!trimmed) return;
  // 1) append the message
  await addDoc(collection(db, "chatThreads", args.threadId, "messages"), {
    senderUid: args.senderUid,
    senderName: args.senderName,
    senderEmail: args.senderEmail,
    body: trimmed,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
  });
  // 2) bump thread preview so the list re-orders without an extra read.
  await updateDoc(doc(db, "chatThreads", args.threadId), {
    lastMessagePreview: trimmed.slice(0, 140),
    lastMessageAt: serverTimestamp(),
    lastMessageSenderUid: args.senderUid,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Edit a message body. Server-rule enforcement: senderUid must equal the
 * caller, and only `body` + `editedAt` may change.
 */
export async function editChatMessage(args: {
  threadId: string;
  messageId: string;
  newBody: string;
}): Promise<void> {
  const trimmed = args.newBody.trim();
  if (!trimmed) return;
  await updateDoc(doc(db, "chatThreads", args.threadId, "messages", args.messageId), {
    body: trimmed,
    editedAt: serverTimestamp(),
  });
}

/**
 * Soft-delete a message bubble. Moderator-only (rules enforce). The bubble
 * keeps its sender info so the UI can render a "Message deleted by <mod>"
 * tombstone without leaking the original body.
 */
export async function softDeleteChatMessage(args: {
  threadId: string;
  messageId: string;
  moderatorUid: string;
}): Promise<void> {
  await updateDoc(doc(db, "chatThreads", args.threadId, "messages", args.messageId), {
    deleted: true,
    deletedByUid: args.moderatorUid,
    deletedAt: serverTimestamp(),
    body: "", // wipe content; rules permit moderator to clear it
  });
}

/**
 * Soft-archive a thread — drops it from every participant's thread list
 * via the `archived: true` flag. Moderator-only (rules enforce).
 */
export async function archiveChatThread(args: {
  threadId: string;
  moderatorUid: string;
}): Promise<void> {
  await updateDoc(doc(db, "chatThreads", args.threadId), {
    archived: true,
    archivedByUid: args.moderatorUid,
    archivedAt: serverTimestamp(),
  });
}

/**
 * Fetch every other user (excluding self) so the "New chat" picker can
 * render. Reads `users` collection — already permitted by rules for any
 * signed-in teammate. Kept as a one-shot getDocs (small org).
 */
export async function listOtherUsers(selfUid: string): Promise<
  { uid: string; email: string; displayName: string; role: string }[]
> {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((d) => {
      const data = d.data() as { email?: string; displayName?: string; role?: string };
      return {
        uid: d.id,
        email: data.email ?? "",
        displayName: data.displayName ?? data.email ?? "Unnamed",
        role: data.role ?? "agent",
      };
    })
    .filter((u) => u.uid !== selfUid);
}

// ---------------------------------------------------------------------------
// Read receipts & typing indicators
// ---------------------------------------------------------------------------
//
// Both pieces of state live as map fields on the thread doc (`readState`
// and `typingState`) keyed by uid. This keeps everything inside the
// existing thread snapshot — no extra listeners, no fan-out cost — and
// the firestore.rules `update` rule for chatThreads already permits any
// participant to write to the thread doc (we never touch participant lists).
//
// Typing state is "fresh" if it's within ~5s of now. We refresh while the
// user is composing and clear it on send / blur.

export const TYPING_FRESH_MS = 5_000;

/**
 * Returns the number of threads with at least one message from someone other
 * than `selfUid` whose `lastMessageAt` is newer than this user's
 * `readState[selfUid]`. Threads I sent the latest message in never count
 * (matches Slack/iMessage behavior).
 */
export function countUnreadThreads(threads: ChatThread[], selfUid: string): number {
  let n = 0;
  for (const t of threads) {
    if (t.archived) continue;
    if (!t.lastMessageAt || !t.lastMessageSenderUid) continue;
    if (t.lastMessageSenderUid === selfUid) continue;
    const lastMs = t.lastMessageAt.toMillis?.() ?? 0;
    const readMs = t.readState?.[selfUid]?.toMillis?.() ?? 0;
    if (lastMs > readMs) n += 1;
  }
  return n;
}

/** True if a given thread is unread for `selfUid`. */
export function isThreadUnread(t: ChatThread, selfUid: string): boolean {
  if (t.archived) return false;
  if (!t.lastMessageAt || !t.lastMessageSenderUid) return false;
  if (t.lastMessageSenderUid === selfUid) return false;
  const lastMs = t.lastMessageAt.toMillis?.() ?? 0;
  const readMs = t.readState?.[selfUid]?.toMillis?.() ?? 0;
  return lastMs > readMs;
}

/**
 * Stamp my readState entry on the thread to "now", marking it read for me.
 * Idempotent — safe to call repeatedly when the same thread stays open.
 */
export async function markThreadRead(threadId: string, selfUid: string): Promise<void> {
  try {
    await updateDoc(doc(db, "chatThreads", threadId), {
      [`readState.${selfUid}`]: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal — read receipts are best-effort.
    console.warn("markThreadRead failed:", err);
  }
}

/**
 * Refresh my typing flag on the thread. Safe to call on every keystroke —
 * the caller throttles via `lastTypingPingRef` in the Chat page so we don't
 * write more than once every ~3s.
 */
export async function pingTyping(threadId: string, selfUid: string): Promise<void> {
  try {
    await updateDoc(doc(db, "chatThreads", threadId), {
      [`typingState.${selfUid}`]: serverTimestamp(),
    });
  } catch (err) {
    console.warn("pingTyping failed:", err);
  }
}

/**
 * Clear my typing flag (on send or blur). Writes a far-past timestamp so
 * `isParticipantTyping` immediately returns false on every other client.
 */
export async function clearTyping(threadId: string, selfUid: string): Promise<void> {
  try {
    await updateDoc(doc(db, "chatThreads", threadId), {
      [`typingState.${selfUid}`]: Timestamp.fromMillis(0),
    });
  } catch (err) {
    console.warn("clearTyping failed:", err);
  }
}

/**
 * True if the *other* participant has pinged a typing flag within the last
 * TYPING_FRESH_MS. We pass `nowMs` from the consumer so a setInterval tick
 * can re-evaluate freshness without a Firestore round-trip.
 */
export function isOtherTyping(t: ChatThread | null, selfUid: string, nowMs: number): boolean {
  if (!t || !t.typingState) return false;
  for (const [uid, ts] of Object.entries(t.typingState)) {
    if (uid === selfUid) continue;
    const ms = ts?.toMillis?.() ?? 0;
    if (nowMs - ms < TYPING_FRESH_MS) return true;
  }
  return false;
}
