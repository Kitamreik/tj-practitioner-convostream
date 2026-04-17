/**
 * ConvoHub Cloud Functions
 *
 * Scheduled retention enforcement for soft-deleted ("archived") items.
 *
 * Both `conversations` and `people` documents are soft-deleted by setting:
 *   { archived: true, deletedAt: Firestore.Timestamp }
 *
 * After 30 days they should be permanently removed server-side. This function
 * runs daily at 03:00 UTC and purges expired items, including the
 * `messages` subcollection on each conversation.
 *
 * Deploy:   cd functions && npm install && npm run deploy
 * Trigger manually for testing:
 *   firebase functions:shell  →  purgeArchivedHttp({})
 *
 * The HTTP variant lets an admin trigger a one-off purge from a browser/CLI.
 * It requires a shared secret stored in Firebase config:
 *   firebase functions:config:set purge.secret="<random-32-char-string>"
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Permanently delete archived conversations + their `messages` subcollection,
 * and archived people, that exceeded the retention window.
 *
 * Returns counts so the scheduler logs are useful.
 */
async function purgeArchived(): Promise<{
  conversationsDeleted: number;
  messagesDeleted: number;
  peopleDeleted: number;
}> {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - RETENTION_MS);
  let conversationsDeleted = 0;
  let messagesDeleted = 0;
  let peopleDeleted = 0;

  // ---- Conversations ----
  const expiredConvos = await db
    .collection("conversations")
    .where("archived", "==", true)
    .where("deletedAt", "<", cutoff)
    .get();

  for (const convoDoc of expiredConvos.docs) {
    // Delete the messages subcollection in batches of 400 (Firestore batch limit 500).
    const msgs = await convoDoc.ref.collection("messages").get();
    let batch = db.batch();
    let opCount = 0;
    for (const m of msgs.docs) {
      batch.delete(m.ref);
      opCount++;
      messagesDeleted++;
      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();
    await convoDoc.ref.delete();
    conversationsDeleted++;
  }

  // ---- People ----
  const expiredPeople = await db
    .collection("people")
    .where("archived", "==", true)
    .where("deletedAt", "<", cutoff)
    .get();

  let peopleBatch = db.batch();
  let peopleOps = 0;
  for (const personDoc of expiredPeople.docs) {
    peopleBatch.delete(personDoc.ref);
    peopleDeleted++;
    peopleOps++;
    if (peopleOps >= 400) {
      await peopleBatch.commit();
      peopleBatch = db.batch();
      peopleOps = 0;
    }
  }
  if (peopleOps > 0) await peopleBatch.commit();

  // Audit trail entry so admins can see purges in Firestore.
  await db.collection("retentionAudit").add({
    runAt: admin.firestore.FieldValue.serverTimestamp(),
    cutoff,
    conversationsDeleted,
    messagesDeleted,
    peopleDeleted,
  });

  return { conversationsDeleted, messagesDeleted, peopleDeleted };
}

/**
 * Scheduled job — daily at 03:00 UTC.
 */
export const scheduledArchivePurge = onSchedule(
  { schedule: "0 3 * * *", timeZone: "UTC", retryCount: 3 },
  async () => {
    const result = await purgeArchived();
    logger.info("scheduledArchivePurge complete", result);
  }
);

/**
 * HTTP trigger — useful for one-off admin runs.
 * POST { "secret": "<purge.secret>" }
 */
export const purgeArchivedHttp = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const expected = process.env.PURGE_SECRET || "";
  const provided = (req.body && (req.body as { secret?: string }).secret) || "";
  if (!expected || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await purgeArchived();
    res.status(200).json({ ok: true, ...result });
  } catch (err: unknown) {
    logger.error("purgeArchivedHttp failed", err);
    res.status(500).json({ error: (err as Error).message });
  }
});
