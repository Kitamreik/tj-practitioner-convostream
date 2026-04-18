/**
 * Drop an in-app notification into every webmaster's bell when an agent
 * uses the Call/Text Webmaster shortcut. Mirrors `notifyAllUsers` but
 * targets only `users` whose `role == 'webmaster'` so we don't spam the
 * whole team.
 *
 * The doc shape matches what /notifications already renders:
 *   { type: 'call' | 'message', title, description, link, read:false,
 *     isNote:false, broadcast:true, createdAt }
 *
 * `broadcast:true` + `read:false` is required by the Firestore rules to
 * permit cross-user writes (see `users/{uid}/notifications` rule).
 */
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface NotifyWebmasterInput {
  channel: "call" | "text";
  agentName: string;
  /** Current route the agent is on, for instant context. */
  route: string;
}

export async function notifyWebmasterOnContact(input: NotifyWebmasterInput): Promise<number> {
  let snap;
  try {
    snap = await getDocs(query(collection(db, "users"), where("role", "==", "webmaster")));
  } catch (e) {
    console.warn("notifyWebmasterOnContact: could not list webmasters:", e);
    return 0;
  }
  const uids = snap.docs.map((d) => d.id).filter(Boolean);
  if (uids.length === 0) return 0;

  const channelLabel = input.channel === "call" ? "called" : "texted";
  const safeRoute = (input.route || "/").slice(0, 120);
  const title = `${input.agentName} ${channelLabel} you`;
  const description = `From ${safeRoute} · via the in-app webmaster shortcut.`;

  const batch = writeBatch(db);
  uids.forEach((uid) => {
    const ref = doc(collection(db, "users", uid, "notifications"));
    batch.set(ref, {
      type: input.channel === "call" ? "call" : "message",
      title,
      description,
      link: safeRoute,
      read: false,
      isNote: false,
      broadcast: true,
      createdAt: serverTimestamp(),
    });
  });
  try {
    await batch.commit();
    return uids.length;
  } catch (e) {
    console.warn("notifyWebmasterOnContact: batch failed:", e);
    return 0;
  }
}
