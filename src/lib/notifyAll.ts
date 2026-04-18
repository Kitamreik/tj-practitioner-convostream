import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Fan-out a notification into every user's `users/{uid}/notifications`
 * subcollection. Used when a webmaster posts a Staff Update or anyone uploads
 * a File Recording so the bell badge lights up across the team.
 *
 * Notes:
 * - Client-side fan-out: requires Firestore rules to permit listing /users and
 *   targeted writes into other users' notifications subcollections (see
 *   firestore.rules — `notifications` create rule).
 * - Best-effort: failures are logged but do not interrupt the originating
 *   action. The originating doc (staff_updates / file_recordings index) is
 *   the source of truth.
 */
export interface NotifyAllInput {
  type: "message" | "call" | "alert";
  title: string;
  description: string;
  /** Optional source path so /notifications can deep-link in the future. */
  link?: string;
}

export async function notifyAllUsers(input: NotifyAllInput): Promise<number> {
  let snap;
  try {
    snap = await getDocs(collection(db, "users"));
  } catch (e) {
    console.warn("notifyAllUsers: could not list users:", e);
    return 0;
  }

  const uids = snap.docs.map((d) => d.id).filter(Boolean);
  if (uids.length === 0) return 0;

  // Firestore batches cap at 500 writes — chunk just in case.
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < uids.length; i += CHUNK) {
    const slice = uids.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    slice.forEach((uid) => {
      const ref = doc(collection(db, "users", uid, "notifications"));
      batch.set(ref, {
        type: input.type,
        title: input.title,
        description: input.description,
        link: input.link ?? null,
        read: false,
        isNote: false,
        broadcast: true,
        createdAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
      written += slice.length;
    } catch (e) {
      console.warn("notifyAllUsers: batch failed:", e);
    }
  }
  return written;
}
