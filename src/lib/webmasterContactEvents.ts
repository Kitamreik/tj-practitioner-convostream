/**
 * Append-only log of webmaster contact events. Drives the small history
 * panel under the cooldown section on /settings so the on-call webmaster can
 * spot patterns ("agent X has texted me 4 times this hour, something's
 * wrong").
 *
 * Schema (collection: `webmasterContactEvents`):
 *   { agentUid, agentName, channel: 'call' | 'text', route, createdAt }
 *
 * Reads are webmaster-only (sensitive — exposes who reached out, when, and
 * from which page). Creates are open to any signed-in user but the rules
 * pin `agentUid` to `request.auth.uid` so an attacker can't fake another
 * agent's contact event.
 */
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface WebmasterContactEvent {
  id: string;
  agentUid: string;
  agentName: string;
  channel: "call" | "text";
  route: string;
  createdAt: { toDate?: () => Date } | null;
}

const COLLECTION = "webmasterContactEvents";

export async function logWebmasterContactEvent(input: {
  agentUid: string;
  agentName: string;
  channel: "call" | "text";
  route: string;
}): Promise<void> {
  try {
    await addDoc(collection(db, COLLECTION), {
      agentUid: input.agentUid,
      agentName: (input.agentName || "Unknown").slice(0, 120),
      channel: input.channel,
      route: (input.route || "/").slice(0, 240),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Never block the OS hand-off on telemetry — the in-app bell + Slack
    // ping are the source-of-truth alert; this log is just for /settings.
    console.warn("logWebmasterContactEvent failed:", e);
  }
}

/**
 * Subscribe to the most recent N events. Webmaster-only by Firestore rules;
 * the listener will silently no-op for non-webmasters via the error handler.
 */
export function subscribeRecentContactEvents(
  count: number,
  cb: (rows: WebmasterContactEvent[]) => void
): () => void {
  const q = query(
    collection(db, COLLECTION),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const data = d.data() as Omit<WebmasterContactEvent, "id">;
          return { id: d.id, ...data };
        })
      );
    },
    (err) => {
      console.warn("subscribeRecentContactEvents error:", err);
      cb([]);
    }
  );
}
