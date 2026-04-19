/**
 * Offline-send outbox for Team Chat.
 *
 * Why: `sendChatMessage` writes optimistically to the local cache so the
 * sender's own bubble is visible immediately, but if the user is offline
 * (or Firestore is down) the actual `addDoc` call rejects and the message
 * is effectively stuck on that one device. This module adds a small
 * persisted queue so any unsent message gets re-tried automatically the
 * next time the browser regains connectivity.
 *
 * Design:
 *   - Queue lives in localStorage, scoped per-uid (same scoping as
 *     chatCache so two accounts on one browser don't cross-flush).
 *   - On every send attempt we enqueue, then optimistically try to write
 *     to Firestore. On success we dequeue. On failure the entry stays.
 *   - A single global `flushOutbox()` runs whenever:
 *       (a) the AuthContext mounts a signed-in user (covers reload case),
 *       (b) the browser fires `online`,
 *       (c) the Chat page comes back into focus.
 *   - Flushing is serialized (one in-flight at a time per uid) and
 *     processes oldest-first so message order is preserved.
 *   - We use a *deterministic* `clientId` per queued message and write it
 *     into the Firestore doc payload so the merge logic in chatCache can
 *     de-dupe against optimistic copies even if the network round-trip
 *     duplicates a send.
 */

import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const OUTBOX_KEY = (uid: string) => `convohub.chat.outbox.v1.${uid}`;

export interface OutboxEntry {
  /** Stable client-generated id; matches the optimistic cache row's id. */
  clientId: string;
  threadId: string;
  senderUid: string;
  senderName: string;
  senderEmail: string;
  body: string;
  /** ms since epoch of the original send attempt — used to preserve order. */
  enqueuedAtMs: number;
  /** How many times we've already tried to flush this entry. */
  attempts: number;
}

function readQueue(uid: string): OutboxEntry[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(OUTBOX_KEY(uid));
    if (!raw) return [];
    const arr = JSON.parse(raw) as OutboxEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn("chatOutbox.readQueue failed:", err);
    return [];
  }
}

function writeQueue(uid: string, entries: OutboxEntry[]): void {
  if (!uid) return;
  try {
    if (entries.length === 0) {
      localStorage.removeItem(OUTBOX_KEY(uid));
    } else {
      localStorage.setItem(OUTBOX_KEY(uid), JSON.stringify(entries));
    }
  } catch (err) {
    console.warn("chatOutbox.writeQueue failed:", err);
  }
}

/** Enqueue a pending send. Returns the entry (with its assigned clientId). */
export function enqueueOutbox(
  entry: Omit<OutboxEntry, "enqueuedAtMs" | "attempts"> & { enqueuedAtMs?: number }
): OutboxEntry {
  const full: OutboxEntry = {
    ...entry,
    enqueuedAtMs: entry.enqueuedAtMs ?? Date.now(),
    attempts: 0,
  };
  const q = readQueue(entry.senderUid);
  // Replace any existing entry with the same clientId (idempotent re-enqueue).
  const filtered = q.filter((e) => e.clientId !== entry.clientId);
  filtered.push(full);
  filtered.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  writeQueue(entry.senderUid, filtered);
  return full;
}

/** Remove a specific entry by clientId once it's been confirmed by the server. */
export function dequeueOutbox(uid: string, clientId: string): void {
  const q = readQueue(uid);
  const next = q.filter((e) => e.clientId !== clientId);
  if (next.length !== q.length) writeQueue(uid, next);
}

export function getOutboxSize(uid: string): number {
  return readQueue(uid).length;
}

export function listOutbox(uid: string): OutboxEntry[] {
  return readQueue(uid);
}

/**
 * Try to flush every pending entry for this uid. Safe to call repeatedly —
 * if a flush is already in flight for this uid we no-op. Resolves once the
 * current pass completes (success, partial failure, or skipped).
 *
 * Returns the number of entries successfully flushed.
 */
const inFlightFlush = new Map<string, Promise<number>>();

export function flushOutbox(uid: string): Promise<number> {
  if (!uid) return Promise.resolve(0);
  const existing = inFlightFlush.get(uid);
  if (existing) return existing;

  const p = (async () => {
    // Don't even try if the browser thinks it's offline — saves a guaranteed
    // failed round-trip per entry. The `online` event will retrigger us.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

    const queue = readQueue(uid);
    if (queue.length === 0) return 0;

    let flushed = 0;
    // Process oldest first; stop on first failure to preserve order.
    for (const entry of queue) {
      try {
        await addDoc(collection(db, "chatThreads", entry.threadId, "messages"), {
          senderUid: entry.senderUid,
          senderName: entry.senderName,
          senderEmail: entry.senderEmail,
          body: entry.body,
          createdAt: serverTimestamp(),
          editedAt: null,
          deleted: false,
          clientId: entry.clientId, // de-dup hint for merge logic
        });
        await updateDoc(doc(db, "chatThreads", entry.threadId), {
          lastMessagePreview: entry.body.slice(0, 140),
          lastMessageAt: serverTimestamp(),
          lastMessageSenderUid: entry.senderUid,
          updatedAt: serverTimestamp(),
        });
        dequeueOutbox(uid, entry.clientId);
        flushed += 1;
      } catch (err) {
        // Bump the attempt counter and stop — next online tick will retry.
        const cur = readQueue(uid);
        const idx = cur.findIndex((e) => e.clientId === entry.clientId);
        if (idx >= 0) {
          cur[idx] = { ...cur[idx], attempts: cur[idx].attempts + 1 };
          writeQueue(uid, cur);
        }
        console.warn("chatOutbox.flush failed for", entry.clientId, err);
        break;
      }
    }
    return flushed;
  })().finally(() => {
    inFlightFlush.delete(uid);
  });

  inFlightFlush.set(uid, p);
  return p;
}

/**
 * Wire up auto-flush triggers for this uid. Returns an unsubscribe.
 * Idempotent — calling twice returns two independent unsub functions.
 */
export function startOutboxAutoFlush(uid: string): () => void {
  if (!uid || typeof window === "undefined") return () => {};

  const fire = () => {
    void flushOutbox(uid);
  };

  // Fire once on startup in case there's a backlog from a previous session.
  fire();

  window.addEventListener("online", fire);
  window.addEventListener("focus", fire);
  // Also retry on tab-visibility flips (mobile Safari often suppresses
  // "online" in background tabs).
  const onVis = () => {
    if (document.visibilityState === "visible") fire();
  };
  document.addEventListener("visibilitychange", onVis);

  // Periodic safety-net flush every 30s — covers networks that come back
  // without firing the `online` event (some corporate VPNs, captive portals).
  const interval = window.setInterval(fire, 30_000);

  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("focus", fire);
    document.removeEventListener("visibilitychange", onVis);
    window.clearInterval(interval);
  };
}

/** Wipe the outbox (e.g. on sign-out). */
export function clearOutbox(uid: string): void {
  if (!uid) return;
  try {
    localStorage.removeItem(OUTBOX_KEY(uid));
  } catch {
    /* non-fatal */
  }
}
