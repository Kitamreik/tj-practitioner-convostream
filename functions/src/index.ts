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
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";

admin.initializeApp();
const db = admin.firestore();

// =============================================================================
// Role management — callable functions
// =============================================================================

const ESCALATION_NOTIFY_EMAIL = "kit.tjclasses@gmail.com";

/**
 * Webmaster-only: promote another user to a given role (typically "webmaster").
 * Writes the role using the `_serverRoleWrite` sentinel so the
 * `enforceUserRoleOnWrite` trigger accepts the change, and records an audit
 * entry under `roleGrants`.
 *
 * Request: { targetEmail: string, role: "admin" | "webmaster" }
 */
export const promoteToWebmaster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerRole = (callerSnap.data() as { role?: string } | undefined)?.role;
  if (callerRole !== "webmaster") {
    throw new HttpsError("permission-denied", "Only webmasters can grant roles.");
  }

  const data = (request.data ?? {}) as { targetEmail?: unknown; role?: unknown };
  const targetEmail = typeof data.targetEmail === "string" ? data.targetEmail.trim().toLowerCase() : "";
  const newRole = data.role === "admin" || data.role === "webmaster" ? data.role : "webmaster";
  if (!targetEmail || !targetEmail.includes("@")) {
    throw new HttpsError("invalid-argument", "A valid targetEmail is required.");
  }

  // Find target user by email.
  const targetQuery = await db.collection("users").where("email", "==", targetEmail).limit(1).get();
  if (targetQuery.empty) {
    throw new HttpsError("not-found", `No user found with email ${targetEmail}.`);
  }
  const targetDoc = targetQuery.docs[0];
  const previousRole = (targetDoc.data() as { role?: string }).role ?? "admin";

  await targetDoc.ref.update({
    role: newRole,
    escalatedAccess: newRole === "webmaster" ? true : admin.firestore.FieldValue.delete(),
    _serverRoleWrite: true,
  });

  await db.collection("roleGrants").add({
    targetUid: targetDoc.id,
    targetEmail,
    previousRole,
    newRole,
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("promoteToWebmaster: role granted", {
    targetUid: targetDoc.id,
    targetEmail,
    previousRole,
    newRole,
    grantedByUid: callerUid,
  });

  return { ok: true, targetUid: targetDoc.id, previousRole, newRole };
});

/**
 * Build a nodemailer transport from env vars, or return null if SMTP isn't
 * configured. Shared by all email-sending callables so we have one source of
 * truth for credentials and behavior.
 */
function buildTransport(): nodemailer.Transporter | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEscalationEmail(opts: {
  subject: string;
  text: string;
}): Promise<{ sent: boolean; error: string | null }> {
  const transport = buildTransport();
  if (!transport) return { sent: false, error: "SMTP not configured" };
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ESCALATION_NOTIFY_EMAIL,
      subject: opts.subject,
      text: opts.text,
    });
    return { sent: true, error: null };
  } catch (err: unknown) {
    const message = (err as Error).message;
    logger.error("sendEscalationEmail failed", err);
    return { sent: false, error: message };
  }
}

/**
 * Admin escalation request: any signed-in admin can request expanded access
 * (Integrations / Analytics / Gmail API). Persists a record in
 * `escalationRequests` and emails ESCALATION_NOTIFY_EMAIL via SMTP if creds
 * are configured (env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 * If SMTP is not configured the request is still recorded so a webmaster can
 * approve it manually from the audit trail.
 *
 * Request: { reason?: string }
 */
export const requestWebmasterEscalation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "Profile missing.");
  }
  const userData = userSnap.data() as { email?: string; displayName?: string; role?: string };

  const data = (request.data ?? {}) as { reason?: unknown };
  const reason = typeof data.reason === "string" ? data.reason.slice(0, 500) : "";

  const requestRef = await db.collection("escalationRequests").add({
    requesterUid: uid,
    requesterEmail: userData.email ?? null,
    requesterName: userData.displayName ?? null,
    requesterRole: userData.role ?? "admin",
    reason,
    status: "pending",
    notifiedEmail: ESCALATION_NOTIFY_EMAIL,
    emailSent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const { sent, error } = await sendEscalationEmail({
    subject: `[ConvoHub] Webmaster escalation requested by ${userData.email ?? uid}`,
    text:
      `User ${userData.displayName ?? "(no name)"} <${userData.email ?? uid}> ` +
      `(role: ${userData.role ?? "admin"}) is requesting webmaster escalation.\n\n` +
      `Reason: ${reason || "(none provided)"}\n\n` +
      `Request ID: ${requestRef.id}\n\n` +
      `Approve by promoting them in the ConvoHub Settings page, or directly ` +
      `via the promoteToWebmaster callable.`,
  });

  await requestRef.update({
    emailSent: sent,
    ...(error ? { emailError: error } : {}),
  });

  return { ok: true, requestId: requestRef.id, emailSent: sent, emailError: error };
});

/**
 * Webmaster approves or denies a pending escalation request.
 * On approve: also grants escalatedAccess=true to the requester (server-authored).
 *
 * Request: { requestId: string, decision: "approve" | "deny" }
 */
export const decideEscalationRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const { requestId, decision } = (request.data ?? {}) as {
    requestId?: unknown;
    decision?: unknown;
  };
  if (typeof requestId !== "string" || !requestId) {
    throw new HttpsError("invalid-argument", "requestId required.");
  }
  if (decision !== "approve" && decision !== "deny") {
    throw new HttpsError("invalid-argument", "decision must be 'approve' or 'deny'.");
  }

  const reqRef = db.collection("escalationRequests").doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError("not-found", "Request not found.");
  const reqData = reqSnap.data() as { requesterUid?: string; status?: string };
  if (reqData.status && reqData.status !== "pending") {
    throw new HttpsError("failed-precondition", `Request already ${reqData.status}.`);
  }
  if (!reqData.requesterUid) {
    throw new HttpsError("failed-precondition", "Request is missing requesterUid.");
  }

  const newStatus = decision === "approve" ? "approved" : "denied";

  await reqRef.update({
    status: newStatus,
    decidedAt: admin.firestore.FieldValue.serverTimestamp(),
    decidedByUid: request.auth.uid,
    decidedByEmail: callerSnap.data()?.email ?? null,
  });

  if (decision === "approve") {
    await db.doc(`users/${reqData.requesterUid}`).update({
      escalatedAccess: true,
      _serverRoleWrite: true,
    });
    logger.info("decideEscalationRequest: approved", { requestId, requesterUid: reqData.requesterUid });
  } else {
    logger.info("decideEscalationRequest: denied", { requestId });
  }

  return { ok: true, status: newStatus };
});

/**
 * Webmaster-only: permanently delete a user account (Auth + Firestore profile).
 * Refuses to delete the caller's own account.
 *
 * Request: { targetUid: string }
 */
export const deleteUserAccount = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const { targetUid } = (request.data ?? {}) as { targetUid?: unknown };
  if (typeof targetUid !== "string" || !targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "Webmasters cannot delete themselves.");
  }

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  const targetEmail = targetSnap.exists
    ? (targetSnap.data() as { email?: string }).email ?? null
    : null;

  // Delete Firebase Auth user (idempotent — ignore "user not found").
  try {
    await admin.auth().deleteUser(targetUid);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      logger.error("deleteUserAccount: auth delete failed", err);
      throw new HttpsError("internal", `Auth delete failed: ${(err as Error).message}`);
    }
  }

  if (targetSnap.exists) await targetRef.delete();

  await db.collection("accountDeletions").add({
    targetUid,
    targetEmail,
    deletedByUid: callerUid,
    deletedByEmail: callerSnap.data()?.email ?? null,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("deleteUserAccount: deleted", { targetUid, targetEmail, by: callerUid });
  return { ok: true, targetUid, targetEmail };
});

/**
 * Webmaster-only: revoke a previously-granted escalated access flag for an
 * admin. Uses the `_serverRoleWrite` sentinel so the
 * `enforceUserRoleOnWrite` trigger accepts the change. Recorded in
 * `roleGrants` for the audit trail (newRole = "admin", escalated=false).
 *
 * Request: { targetUid: string }
 */
export const revokeEscalatedAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetUid?: unknown; reason?: unknown };
  const targetUid = typeof data.targetUid === "string" ? data.targetUid : "";
  const reason = typeof data.reason === "string" ? data.reason.trim().slice(0, 1000) : "";
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  if (!reason) {
    throw new HttpsError("invalid-argument", "A reason for revoking is required.");
  }

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
  const targetData = targetSnap.data() as { email?: string; role?: string; escalatedAccess?: boolean };

  if (targetData.role === "webmaster") {
    throw new HttpsError("failed-precondition", "Cannot revoke escalation from a webmaster. Demote first.");
  }
  if (!targetData.escalatedAccess) {
    return { ok: true, alreadyRevoked: true };
  }

  await targetRef.update({
    escalatedAccess: false,
    _serverRoleWrite: true,
  });

  await db.collection("roleGrants").add({
    targetUid,
    targetEmail: targetData.email ?? null,
    previousRole: "admin+escalated",
    newRole: "admin",
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "revokeEscalatedAccess",
    reason,
  });

  logger.info("revokeEscalatedAccess: revoked", { targetUid, by: callerUid, reason });
  return { ok: true };
});

/**
 * Webmaster-only: resolve an investigation request.
 * Request: { requestId: string, resolutionNote?: string }
 */
export const resolveInvestigationRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const { requestId, resolutionNote } = (request.data ?? {}) as {
    requestId?: unknown;
    resolutionNote?: unknown;
  };
  if (typeof requestId !== "string" || !requestId) {
    throw new HttpsError("invalid-argument", "requestId required.");
  }
  const note = typeof resolutionNote === "string" ? resolutionNote.slice(0, 1000) : "";

  const ref = db.collection("investigationRequests").doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Request not found.");

  await ref.update({
    status: "resolved",
    resolutionNote: note,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedByUid: request.auth.uid,
    resolvedByEmail: callerSnap.data()?.email ?? null,
  });

  logger.info("resolveInvestigationRequest: resolved", { requestId, by: request.auth.uid });
  return { ok: true };
});

/**
 * Any signed-in user can flag a conversation for webmaster investigation.
 * Persists to `investigationRequests` and emails ESCALATION_NOTIFY_EMAIL.
 *
 * Request: { conversationId: string, customerName?: string, reason?: string }
 */
export const requestConversationInvestigation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = (userSnap.data() ?? {}) as { email?: string; displayName?: string };

  const data = (request.data ?? {}) as {
    conversationId?: unknown;
    customerName?: unknown;
    reason?: unknown;
  };
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  const customerName = typeof data.customerName === "string" ? data.customerName.slice(0, 200) : "";
  const reason = typeof data.reason === "string" ? data.reason.slice(0, 1000) : "";
  if (!conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }

  const ref = await db.collection("investigationRequests").add({
    conversationId,
    customerName,
    reason,
    requesterUid: uid,
    requesterEmail: userData.email ?? null,
    requesterName: userData.displayName ?? null,
    notifiedEmail: ESCALATION_NOTIFY_EMAIL,
    emailSent: false,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const { sent, error } = await sendEscalationEmail({
    subject: `[ConvoHub] Conversation investigation requested${customerName ? ` — ${customerName}` : ""}`,
    text:
      `${userData.displayName ?? "(no name)"} <${userData.email ?? uid}> is asking a webmaster ` +
      `to investigate conversation ${conversationId}` +
      `${customerName ? ` with ${customerName}` : ""}.\n\n` +
      `Reason: ${reason || "(none provided)"}\n\n` +
      `Request ID: ${ref.id}`,
  });

  await ref.update({
    emailSent: sent,
    ...(error ? { emailError: error } : {}),
  });

  return { ok: true, requestId: ref.id, emailSent: sent, emailError: error };
});

/**
 * Defense-in-depth: strip any client-supplied `role` field on writes to
 * users/{uid}. Security rules already prevent non-webmasters from setting or
 * mutating `role`, but if a privileged actor (or a future bug) lets a write
 * through, this trigger guarantees the role can never be escalated by the
 * client. The only legitimate `role` mutation path is server-side admin SDK
 * code (which bypasses this trigger because it sets a sentinel field).
 *
 * Behavior:
 * - On create: if the new doc contains `role` ≠ "admin", reset it to "admin".
 * - On update: if `role` changed and the change wasn't marked server-authored,
 *   restore the previous role.
 * - To allow legitimate server-side role changes, set the sentinel
 *   `_serverRoleWrite: true` on the same write; the trigger will accept it
 *   and clear the sentinel.
 */
export const enforceUserRoleOnWrite = onDocumentWritten(
  "users/{uid}",
  async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after?.exists) return; // doc was deleted; nothing to do

    const afterData = after.data() as Record<string, unknown> | undefined;
    const beforeData = before?.data() as Record<string, unknown> | undefined;
    if (!afterData) return;

    const serverAuthored = afterData._serverRoleWrite === true;
    const newRole = afterData.role;
    const oldRole = beforeData?.role ?? "admin";

    // Server-authored writes are trusted — just clear the sentinel.
    if (serverAuthored) {
      await after.ref.update({
        _serverRoleWrite: admin.firestore.FieldValue.delete(),
      });
      return;
    }

    // Determine what (if anything) needs correcting.
    const updates: Record<string, unknown> = {};

    if (!before?.exists) {
      // CREATE: force baseline `admin` role regardless of what the client sent.
      if (newRole !== "admin") {
        updates.role = "admin";
        logger.warn("enforceUserRoleOnWrite: stripped non-default role on create", {
          uid: event.params.uid,
          attemptedRole: newRole,
        });
      }
    } else {
      // UPDATE: revert any client-driven change to `role`.
      if (newRole !== oldRole) {
        updates.role = oldRole;
        logger.warn("enforceUserRoleOnWrite: reverted client role change", {
          uid: event.params.uid,
          from: oldRole,
          to: newRole,
        });
      }
    }

    if (Object.keys(updates).length > 0) {
      await after.ref.update(updates);
    }
  }
);

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
