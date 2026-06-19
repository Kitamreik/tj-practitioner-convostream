/**
 * Customer portal helpers.
 *
 * - `signUpCustomer` creates a Firebase Auth user with role="customer" and
 *   `approvalStatus: "pending"`. A webmaster or admin must approve the
 *   account from the Signup Approvals panel before the customer can reach
 *   the Team Chat. The signup is logged to `customerSignupLog` for the
 *   admin activity feed.
 * - `claimConversationsForCustomer` runs on every customer sign-in: any
 *   `conversations` doc whose `customerEmail` matches the verified email
 *   and which has no `customerUid` yet gets stamped with the customer's uid,
 *   so subsequent reads are cheap and Firestore rules can isolate by uid.
 * - `updateCustomerProfile` lets a signed-in customer edit their display
 *   name and email after the account is created.
 */
import {
  createUserWithEmailAndPassword,
  updateEmail,
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
  // Customer profile starts pending — a webmaster or admin must approve
  // it from the Signup Approvals panel before the Team Chat is unlocked.
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email: email.trim().toLowerCase(),
    role: "customer",
    displayName: displayName.trim() || email.split("@")[0],
    createdAt: serverTimestamp(),
    approvalStatus: "pending",
    signupSource: "portal-signup",
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
  // Best-effort claim — safe even before approval; the rules still gate
  // reads, but stamping the uid early means it Just Works on first
  // approved sign-in.
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

/**
 * Update a signed-in customer's display name and/or email. Updates Firebase
 * Auth first (since email changes can throw `auth/requires-recent-login`),
 * then mirrors to the `users/{uid}` Firestore profile. Returns a structured
 * result so the UI can show per-field success / failure.
 */
export async function updateCustomerProfile(
  user: User,
  patch: { displayName?: string; email?: string },
): Promise<{ displayNameUpdated: boolean; emailUpdated: boolean; emailError?: string }> {
  let displayNameUpdated = false;
  let emailUpdated = false;
  let emailError: string | undefined;

  const nextName = patch.displayName?.trim();
  const nextEmail = patch.email?.trim().toLowerCase();

  if (nextName !== undefined && nextName !== (user.displayName ?? "")) {
    await updateProfile(user, { displayName: nextName });
    displayNameUpdated = true;
  }

  if (nextEmail && nextEmail !== (user.email ?? "").toLowerCase()) {
    try {
      await updateEmail(user, nextEmail);
      emailUpdated = true;
    } catch (err) {
      emailError = (err as { code?: string; message?: string }).code
        || (err as { message?: string }).message
        || "Could not update email.";
    }
  }

  // Mirror to Firestore — only patch what actually changed in Auth so we
  // never get out of sync with the credential.
  const profilePatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (displayNameUpdated && nextName !== undefined) profilePatch.displayName = nextName;
  if (emailUpdated && nextEmail) profilePatch.email = nextEmail;
  if (Object.keys(profilePatch).length > 1) {
    try {
      await updateDoc(doc(db, "users", user.uid), profilePatch);
    } catch (err) {
      console.warn("updateCustomerProfile: Firestore mirror failed:", err);
    }
  }

  return { displayNameUpdated, emailUpdated, emailError };
}
