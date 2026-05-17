/**
 * Customer portal helpers.
 *
 * - `signUpCustomer` creates a Firebase Auth user with role="customer",
 *   auto-approved, and logs the signup to `customerSignupLog` for the admin
 *   activity feed (per the "Auto-approved but logged" decision).
 * - `claimConversationsForCustomer` runs on every customer sign-in: any
 *   `conversations` doc whose `customerEmail` matches the verified email
 *   and which has no `customerUid` yet gets stamped with the customer's uid,
 *   so subsequent reads are cheap and Firestore rules can isolate by uid.
 */
import {
  createUserWithEmailAndPassword,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export async function signUpCustomer(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName.trim()) {
    try {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    } catch {
      /* non-fatal */
    }
  }
  // Customer profile is auto-approved per the product decision.
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email: email.trim().toLowerCase(),
    role: "customer",
    displayName: displayName.trim() || email.split("@")[0],
    createdAt: serverTimestamp(),
    approvalStatus: "approved",
  });
  // Activity log for admins/webmasters — visible in the signup queue with a
  // distinct "customer-signup" channel so it doesn't pollute agent reviews.
  try {
    await addDoc(collection(db, "customerSignupLog"), {
      uid: cred.user.uid,
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      createdAt: serverTimestamp(),
      source: "portal-signup",
    });
  } catch (err) {
    console.warn("customerSignupLog write failed:", err);
  }
  await claimConversationsForCustomer(cred.user.uid, email);
  return cred.user;
}

/**
 * Stamp `customerUid` on every conversation that matches the customer's
 * verified email but hasn't been linked yet. Best-effort; failures fall back
 * to live email-match queries on the portal page.
 */
export async function claimConversationsForCustomer(
  uid: string,
  email: string,
): Promise<number> {
  const target = email.trim().toLowerCase();
  if (!target) return 0;
  try {
    const q = query(collection(db, "conversations"), where("customerEmail", "==", target));
    const snap = await getDocs(q);
    if (snap.empty) return 0;
    const batch = writeBatch(db);
    let claimed = 0;
    snap.forEach((d) => {
      const data = d.data() as { customerUid?: string };
      if (!data.customerUid) {
        batch.update(d.ref, { customerUid: uid, customerLinkedAt: serverTimestamp() });
        claimed += 1;
      }
    });
    if (claimed > 0) await batch.commit();
    return claimed;
  } catch (err) {
    console.warn("claimConversationsForCustomer failed:", err);
    return 0;
  }
}

/**
 * Rate an agent reply. Stored on the message doc so the conversation thread
 * UI can render historical ratings to the team.
 */
export async function rateMessage(
  conversationId: string,
  messageId: string,
  payload: {
    rating: "up" | "down";
    stars?: number;
    note?: string;
    ratedByUid: string;
  },
): Promise<void> {
  const ref = doc(db, "conversations", conversationId, "messages", messageId);
  await updateDoc(ref, {
    rating: payload.rating,
    ratingStars: typeof payload.stars === "number" ? payload.stars : null,
    ratingNote: payload.note?.trim() || null,
    ratedByUid: payload.ratedByUid,
    ratedAt: serverTimestamp(),
  });
}
