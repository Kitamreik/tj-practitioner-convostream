/**
 * People ↔ Conversations bidirectional sync, keyed by email.
 *
 * When a customer profile is edited from either side (the People list, or the
 * inline modal inside a conversation), we look up the matching record on the
 * other side by email and update it so the two stay in sync.
 *
 * This is best-effort: failures are logged but never thrown to the caller, so
 * a sync miss never blocks the user-facing edit.
 */
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface ProfileSyncFields {
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Find people docs matching this email and update them with the new fields.
 * Used after a Conversation customer is edited.
 */
export async function syncPeopleByEmail(
  email: string,
  fields: ProfileSyncFields
): Promise<number> {
  const target = (email || "").trim().toLowerCase();
  if (!target) return 0;
  try {
    const q = query(collection(db, "people"), where("email", "==", target));
    const snap = await getDocs(q);
    if (snap.empty) return 0;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (fields.name !== undefined) update.name = fields.name;
      if (fields.email !== undefined) update.email = fields.email.toLowerCase();
      if (fields.phone !== undefined) update.phone = fields.phone;
      batch.update(doc(db, "people", d.id), update);
    });
    await batch.commit();
    return snap.size;
  } catch (e) {
    console.warn("syncPeopleByEmail failed:", e);
    return 0;
  }
}

/**
 * Find conversation docs whose customerEmail matches and update their
 * customer fields. Used after a People profile is edited.
 */
export async function syncConversationsByEmail(
  email: string,
  fields: ProfileSyncFields
): Promise<number> {
  const target = (email || "").trim().toLowerCase();
  if (!target) return 0;
  try {
    const q = query(collection(db, "conversations"), where("customerEmail", "==", target));
    const snap = await getDocs(q);
    if (snap.empty) return 0;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      const update: Record<string, unknown> = {};
      if (fields.name !== undefined) update.customerName = fields.name;
      if (fields.email !== undefined) update.customerEmail = fields.email.toLowerCase();
      if (fields.phone !== undefined) update.customerPhone = fields.phone;
      batch.update(doc(db, "conversations", d.id), update);
    });
    await batch.commit();
    return snap.size;
  } catch (e) {
    console.warn("syncConversationsByEmail failed:", e);
    return 0;
  }
}
