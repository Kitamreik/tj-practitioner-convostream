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
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "webmaster") return true;
  if ((profile.email || "").trim().toLowerCase() === SUPPORT_EMAIL) return true;
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
      cb(rows);
    },
    (err) => {
      console.warn("subscribeMyThreads error:", err);
      cb([]);
    }
  );
}

/** Subscribe to messages in a thread, oldest first. */
export function subscribeThreadMessages(
  threadId: string,
  cb: (messages: ChatMessage[]) => void
): () => void {
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
      cb(rows);
    },
    (err) => {
      console.warn("subscribeThreadMessages error:", err);
      cb([]);
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
