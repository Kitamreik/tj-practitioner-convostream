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
// (nodemailer import removed — SMTP-based escalations were replaced by the
// in-app notifications fan-out via notifyWebmastersInApp.)

admin.initializeApp();
const db = admin.firestore();

// =============================================================================
// Role management — callable functions
// =============================================================================


/**
 * Webmaster-only: promote another user to a given role (typically "webmaster").
 * Writes the role using the `_serverRoleWrite` sentinel so the
 * `enforceUserRoleOnWrite` trigger accepts the change, and records an audit
 * entry under `roleGrants`.
 *
 * Request: { targetIdentifier: string, role: "admin" | "webmaster" }
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

  const data = (request.data ?? {}) as { targetIdentifier?: unknown; targetEmail?: unknown; role?: unknown };
  const rawIdentifier =
    typeof data.targetIdentifier === "string"
      ? data.targetIdentifier
      : typeof data.targetEmail === "string"
        ? data.targetEmail
        : "";
  const targetEmail = rawIdentifier.trim().toLowerCase();
  const newRole = data.role === "admin" || data.role === "webmaster" ? data.role : "webmaster";
  if (!targetEmail || !targetEmail.includes("@")) {
    throw new HttpsError("invalid-argument", "A valid account identifier is required.");
  }

  // Find target user by email.
  const targetQuery = await db.collection("users").where("email", "==", targetEmail).limit(1).get();
  if (targetQuery.empty) {
    throw new HttpsError("not-found", `No account found for ${targetEmail}.`);
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

  const escalationRef = await db.collection("escalationRequests").add({
    requestType: "role-promotion",
    requesterUid: callerUid,
    requesterEmail: callerSnap.data()?.email ?? null,
    requesterName: callerSnap.data()?.displayName ?? null,
    requesterRole: callerRole,
    targetUid: targetDoc.id,
    targetIdentifier: targetEmail,
    previousRole,
    newRole,
    source: "promoteToWebmaster",
    reason: `Webmaster role granted to ${targetEmail}.`,
    status: "approved",
    emailSent: false,
    deliveryChannel: "settings-escalation-log",
    log: [
      {
        action: "approved",
        channel: "settings-promote-webmaster",
        at: admin.firestore.Timestamp.now(),
        byUid: callerUid,
        byEmail: callerSnap.data()?.email ?? null,
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("promoteToWebmaster: role granted", {
    targetUid: targetDoc.id,
    targetEmail,
    previousRole,
    newRole,
    grantedByUid: callerUid,
  });

  return { ok: true, targetUid: targetDoc.id, previousRole, newRole, escalationRequestId: escalationRef.id };
});

/**
 * One-shot bootstrap for first-time setup: provisions support@convohub.dev as
 * the initial webmaster + Support user when no webmaster exists yet.
 *
 * This is the ONLY role-mutation callable that does not require an
 * authenticated webmaster caller — by definition there is no webmaster to
 * authenticate as on a fresh install. To prevent it from being abused after
 * setup, it refuses to run as soon as any `users/*` document has
 * `role === "webmaster"`.
 *
 * Behavior:
 *   - If the Firebase Auth user does not exist, it is created with the
 *     caller-supplied `initialPassword` (min 8 chars). If it already exists,
 *     `initialPassword` is ignored.
 *   - The `users/{uid}` profile is upserted with role=webmaster,
 *     supportAccess=true, escalatedAccess=true, and the `_serverRoleWrite`
 *     sentinel so the `enforceUserRoleOnWrite` trigger accepts the write.
 *   - An audit entry is written to `roleGrants` with
 *     action="bootstrapSupportAccount".
 *   - The plaintext `initialPassword` (when supplied) is mirrored into
 *     `managedPasswords/{uid}` for parity with `setUserPassword`.
 *
 * Request: { initialPassword?: string }   (only used if Auth user is created)
 * Response: { ok: true, uid, email, created: boolean }
 */
const SUPPORT_EMAIL = "support@convohub.dev";
const SUPPORT_DISPLAY_NAME = "Support";

export const bootstrapSupportAccount = onCall(async (request) => {
  // Hard gate: refuse if any webmaster already exists.
  const existingWebmasters = await db
    .collection("users")
    .where("role", "==", "webmaster")
    .limit(1)
    .get();
  if (!existingWebmasters.empty) {
    throw new HttpsError(
      "failed-precondition",
      "Bootstrap is disabled: a webmaster already exists. Use promoteToWebmaster instead."
    );
  }

  const data = (request.data ?? {}) as { initialPassword?: unknown };
  const initialPassword =
    typeof data.initialPassword === "string" ? data.initialPassword : "";

  // Look up or create the Firebase Auth user for support@convohub.dev.
  let authUser: admin.auth.UserRecord;
  let created = false;
  try {
    authUser = await admin.auth().getUserByEmail(SUPPORT_EMAIL);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      logger.error("bootstrapSupportAccount: auth lookup failed", err);
      throw new HttpsError("internal", `Auth lookup failed: ${(err as Error).message}`);
    }
    if (initialPassword.length < 8) {
      throw new HttpsError(
        "invalid-argument",
        "initialPassword (min 8 chars) is required to create the support account."
      );
    }
    if (initialPassword.length > 128) {
      throw new HttpsError("invalid-argument", "initialPassword must be 128 characters or fewer.");
    }
    try {
      authUser = await admin.auth().createUser({
        email: SUPPORT_EMAIL,
        password: initialPassword,
        displayName: SUPPORT_DISPLAY_NAME,
        emailVerified: false,
      });
      created = true;
    } catch (createErr: unknown) {
      logger.error("bootstrapSupportAccount: auth create failed", createErr);
      throw new HttpsError(
        "internal",
        `Auth create failed: ${(createErr as Error).message}`
      );
    }
  }

  const uid = authUser.uid;
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const previousRole = userSnap.exists
    ? ((userSnap.data() as { role?: string }).role ?? "agent")
    : "(none)";

  // Re-check the webmaster gate after the (potentially slow) Auth round-trip
  // to defeat a narrow race where two concurrent bootstraps both pass the
  // initial check.
  const recheck = await db
    .collection("users")
    .where("role", "==", "webmaster")
    .limit(1)
    .get();
  if (!recheck.empty && recheck.docs[0].id !== uid) {
    throw new HttpsError(
      "failed-precondition",
      "Bootstrap raced with another webmaster creation; aborting."
    );
  }

  await userRef.set(
    {
      uid,
      email: SUPPORT_EMAIL,
      displayName: userSnap.exists
        ? (userSnap.data() as { displayName?: string }).displayName ?? SUPPORT_DISPLAY_NAME
        : SUPPORT_DISPLAY_NAME,
      role: "webmaster",
      supportAccess: true,
      escalatedAccess: true,
      _serverRoleWrite: true,
      bootstrappedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("roleGrants").add({
    targetUid: uid,
    targetEmail: SUPPORT_EMAIL,
    previousRole,
    newRole: "webmaster",
    grantedByUid: "(bootstrap)",
    grantedByEmail: null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "bootstrapSupportAccount",
    notes: created ? "Auth user created" : "Auth user already existed",
  });

  // Also record the Support grant in the same audit format setSupportAccess
  // uses, so AuditLogs shows both the role grant and the Support grant.
  await db.collection("roleGrants").add({
    targetUid: uid,
    targetEmail: SUPPORT_EMAIL,
    previousRole: "(none)",
    newRole: "webmaster",
    grantedByUid: "(bootstrap)",
    grantedByEmail: null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "grantSupport",
  });

  // Mirror the password into managedPasswords for webmaster lookup parity
  // (only when we actually set one).
  if (created && initialPassword) {
    await db.doc(`managedPasswords/${uid}`).set({
      password: initialPassword,
      email: SUPPORT_EMAIL,
      setByUid: "(bootstrap)",
      setByEmail: null,
      setAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logger.info("bootstrapSupportAccount: complete", {
    uid,
    email: SUPPORT_EMAIL,
    created,
    previousRole,
  });

  return { ok: true, uid, email: SUPPORT_EMAIL, created };
});

// (buildTransport removed — SMTP is no longer used by any callable.)

// (sendEscalationEmail removed — escalations now flow via notifyWebmastersInApp.)

/**
 * Fan-out an in-app notification into every webmaster's `notifications`
 * subcollection. Used by escalation flows so webmasters see escalation
 * requests in the bell instantly without depending on SMTP delivery.
 *
 * Best-effort: failures are logged but never block the originating action —
 * the escalationRequests / investigationRequests doc remains the source of
 * truth.
 */
async function notifyWebmastersInApp(opts: {
  type: "alert" | "message" | "call";
  title: string;
  description: string;
  link?: string | null;
}): Promise<{ delivered: number; error: string | null }> {
  try {
    const wmSnap = await db.collection("users").where("role", "==", "webmaster").get();
    const uids = wmSnap.docs.map((d) => d.id).filter(Boolean);
    if (uids.length === 0) return { delivered: 0, error: "no webmasters" };
    const batch = db.batch();
    uids.forEach((uid) => {
      const ref = db.collection("users").doc(uid).collection("notifications").doc();
      batch.set(ref, {
        type: opts.type,
        title: opts.title.slice(0, 200),
        description: opts.description.slice(0, 500),
        link: opts.link ?? null,
        read: false,
        isNote: false,
        broadcast: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return { delivered: uids.length, error: null };
  } catch (err) {
    logger.error("notifyWebmastersInApp failed", err);
    return { delivered: 0, error: (err as Error).message };
  }
}

/**
 * Admin / agent / support escalation request: any signed-in non-webmaster
 * can request expanded access (Integrations / Analytics / Gmail API).
 * Persists a record in `escalationRequests` AND fans out an in-app
 * notification to every webmaster's bell. Email delivery has been
 * intentionally removed in favor of the notifications queue so escalations
 * are visible in-app immediately and don't depend on SMTP being configured.
 *
 * Request: { reason?: string }
 * Response: { ok, requestId, notified, notifyError }
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
    requestType: "access",
    requesterUid: uid,
    requesterEmail: userData.email ?? null,
    requesterName: userData.displayName ?? null,
    requesterRole: userData.role ?? "admin",
    reason,
    status: "pending",
    // Routing has moved off email — keep the field for back-compat readers
    // but record the actual delivery channel below.
    notifiedEmail: null,
    emailSent: false,
    deliveryChannel: "in-app-notifications",
    log: [
      {
        action: "created",
        channel: "pending-escalation-queue",
        at: admin.firestore.Timestamp.now(),
        byUid: uid,
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const requesterLabel = userData.displayName || userData.email || uid;
  const { delivered, error } = await notifyWebmastersInApp({
    type: "alert",
    title: `Escalation requested by ${requesterLabel}`,
    description:
      (reason ? `Reason: ${reason}` : "No reason provided.") +
      ` (role: ${userData.role ?? "admin"})`,
    link: "/settings",
  });

  await requestRef.update({
    notifiedWebmasters: delivered,
    ...(error ? { notifyError: error } : {}),
  });

  return {
    ok: true,
    requestId: requestRef.id,
    notified: delivered,
    notifyError: error,
    // Legacy field kept so older clients don't crash on `res.data.emailSent`.
    emailSent: false,
    emailError: null,
  };
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
    log: admin.firestore.FieldValue.arrayUnion({
      action: newStatus,
      at: admin.firestore.Timestamp.now(),
      byUid: request.auth.uid,
      byEmail: callerSnap.data()?.email ?? null,
    }),
  });

  const reqType = (reqSnap.data() as { requestType?: string }).requestType ?? "access";
  if (decision === "approve" && reqType === "access") {
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
 * Webmaster-only: set (overwrite) another user's password. Updates Firebase
 * Auth via the admin SDK and stores the plaintext in
 * `managedPasswords/{targetUid}` so the webmaster can look it up later
 * (Firebase Auth itself never returns the hash). The client also mirrors
 * the value into localStorage as an offline fallback.
 *
 * Request: { targetUid: string, newPassword: string }
 */
export const setUserPassword = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerData = callerSnap.data() as { role?: string; email?: string } | undefined;
  if (callerData?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetUid?: unknown; newPassword?: unknown };
  const targetUid = typeof data.targetUid === "string" ? data.targetUid : "";
  const newPassword = typeof data.newPassword === "string" ? data.newPassword : "";
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid required.");
  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  if (newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "Password must be 128 characters or fewer.");
  }

  try {
    await admin.auth().updateUser(targetUid, { password: newPassword });
  } catch (err: unknown) {
    logger.error("setUserPassword: auth update failed", err);
    throw new HttpsError("internal", `Auth update failed: ${(err as Error).message}`);
  }

  const targetSnap = await db.doc(`users/${targetUid}`).get();
  const targetEmail = targetSnap.exists
    ? (targetSnap.data() as { email?: string }).email ?? null
    : null;

  await db.doc(`managedPasswords/${targetUid}`).set({
    password: newPassword,
    email: targetEmail,
    setByUid: callerUid,
    setByEmail: callerData?.email ?? null,
    setAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("setUserPassword: updated", { targetUid, by: callerUid });
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

export const getCallRecordingDownloadUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;
  const data = (request.data ?? {}) as { recordingId?: unknown };
  const recordingId = typeof data.recordingId === "string" ? data.recordingId.trim() : "";
  if (!recordingId) throw new HttpsError("invalid-argument", "recordingId is required.");

  const [userSnap, recSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`callRecordings/${recordingId}`).get(),
  ]);
  if (!recSnap.exists) throw new HttpsError("not-found", "Recording not found.");
  const userData = userSnap.data() as { role?: string } | undefined;
  const rec = recSnap.data() as { agentUid?: string; storagePath?: string; deletedAt?: unknown };
  const canAccess = rec.agentUid === uid || userData?.role === "admin" || userData?.role === "webmaster";
  if (!canAccess) throw new HttpsError("permission-denied", "You are not authorized to access this recording.");
  if (rec.deletedAt || !rec.storagePath) throw new HttpsError("not-found", "Recording is unavailable.");

  const [url] = await admin.storage().bucket().file(rec.storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  await recSnap.ref.update({ lastAccessedAt: admin.firestore.FieldValue.serverTimestamp(), lastAccessedByUid: uid });
  return { url, expiresAt: Date.now() + 15 * 60 * 1000 };
});

/**
 * Webmaster-only: rename an agent (update displayName on users/{uid}).
 * Used by the Settings → Agents tab. Recorded in `roleGrants` with
 * action="renameAgent" so all identity changes have an audit trail.
 *
 * Request: { targetUid: string, displayName: string }
 */
export const updateAgentDisplayName = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetUid?: unknown; displayName?: unknown };
  const targetUid = typeof data.targetUid === "string" ? data.targetUid : "";
  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim().slice(0, 80) : "";
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid required.");
  if (!displayName) throw new HttpsError("invalid-argument", "displayName required.");
  // Reject control characters and angle brackets to mirror client-side nameSchema.
  if (/[<>\u0000-\u001F\u007F]/.test(displayName)) {
    throw new HttpsError("invalid-argument", "displayName contains invalid characters.");
  }

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
  const targetData = targetSnap.data() as { role?: string; displayName?: string; email?: string };
  const previousName = targetData.displayName ?? "";

  await targetRef.update({ displayName });

  await db.collection("roleGrants").add({
    targetUid,
    targetEmail: targetData.email ?? null,
    previousRole: targetData.role ?? "agent",
    newRole: targetData.role ?? "agent",
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "renameAgent",
    previousDisplayName: previousName,
    newDisplayName: displayName,
  });

  logger.info("updateAgentDisplayName: renamed", {
    targetUid,
    by: callerUid,
    from: previousName,
    to: displayName,
  });
  return { ok: true, previousDisplayName: previousName, newDisplayName: displayName };
});

/**
 * Webmaster-only: demote an admin (or admin+escalated) back to "agent".
 * Mirrors `promoteToWebmaster` and writes to `roleGrants` with
 * action="demoteAgent" so the change is auditable. Refuses to demote
 * webmasters (they must be demoted to admin first via promoteToWebmaster
 * with role="admin") and refuses to demote the caller.
 *
 * Request: { targetUid: string, reason?: string }
 */
export const demoteAgent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetUid?: unknown; reason?: unknown };
  const targetUid = typeof data.targetUid === "string" ? data.targetUid : "";
  const reason = typeof data.reason === "string" ? data.reason.trim().slice(0, 1000) : "";
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid required.");
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "Webmasters cannot demote themselves.");
  }

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
  const targetData = targetSnap.data() as { email?: string; role?: string; escalatedAccess?: boolean };
  const previousRole = targetData.role ?? "agent";

  if (previousRole === "webmaster") {
    throw new HttpsError(
      "failed-precondition",
      "Cannot demote a webmaster directly. Use promoteToWebmaster with role='admin' first."
    );
  }
  if (previousRole === "agent" && !targetData.escalatedAccess) {
    return { ok: true, alreadyAgent: true };
  }

  await targetRef.update({
    role: "agent",
    escalatedAccess: admin.firestore.FieldValue.delete(),
    _serverRoleWrite: true,
  });

  await db.collection("roleGrants").add({
    targetUid,
    targetEmail: targetData.email ?? null,
    previousRole: targetData.escalatedAccess ? `${previousRole}+escalated` : previousRole,
    newRole: "agent",
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "demoteAgent",
    reason,
  });

  logger.info("demoteAgent: demoted", { targetUid, by: callerUid, from: previousRole });
  return { ok: true, previousRole, newRole: "agent" };
});

/**
 * Webmaster-only: grant or revoke "Support" access on any user's profile.
 * Sets/clears `users/{uid}.supportAccess` (boolean). When true, the account
 * sees the Support call-center home at `/` and can moderate Team Chat —
 * mirroring what the legacy `support@convohub.dev` email used to unlock.
 *
 * Uses the `_serverRoleWrite` sentinel so `enforceUserRoleOnWrite` accepts
 * the privileged write. Recorded in `roleGrants` with action="grantSupport"
 * or "revokeSupport".
 *
 * Request: { targetUid: string, grant: boolean }
 */
export const setSupportAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if ((callerSnap.data() as { role?: string } | undefined)?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetUid?: unknown; grant?: unknown };
  const targetUid = typeof data.targetUid === "string" ? data.targetUid : "";
  const grant = data.grant === true;
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid required.");

  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
  const targetData = targetSnap.data() as { email?: string; role?: string; supportAccess?: boolean };
  const previous = !!targetData.supportAccess;

  if (previous === grant) {
    return { ok: true, unchanged: true, supportAccess: grant };
  }

  await targetRef.update({
    supportAccess: grant ? true : admin.firestore.FieldValue.delete(),
    _serverRoleWrite: true,
  });

  await db.collection("roleGrants").add({
    targetUid,
    targetEmail: targetData.email ?? null,
    previousRole: targetData.role ?? "agent",
    newRole: targetData.role ?? "agent",
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: grant ? "grantSupport" : "revokeSupport",
  });

  logger.info("setSupportAccess: updated", { targetUid, grant, by: callerUid });
  return { ok: true, supportAccess: grant };
});

/**
 * Webmaster-only: generate a Firebase Auth signup link for a target email
 * so a webmaster can invite a new agent without them self-registering.
 *
 * Behavior:
 *   - If no Auth user exists for the email, one is created with a strong
 *     random password (the invitee resets it via the email-verification link).
 *   - If a Firestore profile is missing, a baseline `agent` profile is
 *     written (server-authored via the `_serverRoleWrite` sentinel so
 *     `enforceUserRoleOnWrite` accepts it).
 *   - Returns an action link the webmaster can copy/paste/share with the
 *     invitee. The link uses Firebase's verifyEmail flow so the invitee
 *     lands on a Firebase-hosted page that confirms their address; they
 *     then sign in with the temp password (also returned) and immediately
 *     change it from the Settings page.
 *
 * Audited via `roleGrants` with action="inviteAgent".
 *
 * Request: { targetEmail: string, displayName?: string, continueUrl?: string }
 */
export const generateAgentSignupLink = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerRole = (callerSnap.data() as { role?: string } | undefined)?.role;
  if (callerRole !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as {
    targetEmail?: unknown;
    displayName?: unknown;
    continueUrl?: unknown;
  };
  const targetEmail =
    typeof data.targetEmail === "string" ? data.targetEmail.trim().toLowerCase() : "";
  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim().slice(0, 80) : "";
  const continueUrl =
    typeof data.continueUrl === "string" && /^https?:\/\//.test(data.continueUrl)
      ? data.continueUrl
      : "https://convo-hub-71514.web.app/login";
  if (!targetEmail || !targetEmail.includes("@")) {
    throw new HttpsError("invalid-argument", "A valid targetEmail is required.");
  }
  if (displayName && /[<>\u0000-\u001F\u007F]/.test(displayName)) {
    throw new HttpsError("invalid-argument", "displayName contains invalid characters.");
  }

  // 1. Find or create the Auth user.
  let userRecord: admin.auth.UserRecord | null = null;
  let createdAuth = false;
  let tempPassword: string | null = null;
  try {
    userRecord = await admin.auth().getUserByEmail(targetEmail);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
  }
  if (!userRecord) {
    // 16-char base64url password, easy to read aloud / paste.
    tempPassword =
      Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url") + "!1A";
    userRecord = await admin.auth().createUser({
      email: targetEmail,
      password: tempPassword,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false,
    });
    createdAuth = true;
  }

  // 2. Ensure a Firestore profile exists with role=agent.
  const profileRef = db.doc(`users/${userRecord.uid}`);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    await profileRef.set({
      uid: userRecord.uid,
      email: targetEmail,
      role: "agent",
      displayName:
        displayName ||
        userRecord.displayName ||
        targetEmail.split("@")[0],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      _serverRoleWrite: true,
    });
  } else if (displayName && (profileSnap.data() as any)?.displayName !== displayName) {
    await profileRef.update({ displayName });
  }

  // 3. Generate a verify-email link the webmaster can share.
  const actionLink = await admin.auth().generateEmailVerificationLink(targetEmail, {
    url: continueUrl,
    handleCodeInApp: false,
  });

  // 4. Audit row so /audit shows who invited whom.
  await db.collection("roleGrants").add({
    targetUid: userRecord.uid,
    targetEmail,
    previousRole: profileSnap.exists ? (profileSnap.data() as any)?.role ?? "agent" : null,
    newRole: "agent",
    grantedByUid: callerUid,
    grantedByEmail: callerSnap.data()?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    action: "inviteAgent",
    createdAuthUser: createdAuth,
  });

  logger.info("generateAgentSignupLink: invited", {
    targetUid: userRecord.uid,
    targetEmail,
    by: callerUid,
    createdAuth,
  });

  return {
    ok: true,
    targetUid: userRecord.uid,
    targetEmail,
    createdAuthUser: createdAuth,
    actionLink,
    tempPassword, // only present when a brand-new auth user was created
  };
});

/**
 * Any signed-in user can flag a conversation for webmaster investigation.
 * Persists to the pending `escalationRequests` queue. Email delivery is not used.
 *
 * Request: { conversationId: string, customerName?: string, reason?: string }
 */
/**
 * "Elevate to webmaster" investigation request.
 *
 * Primary: SMTP email to ESCALATION_NOTIFY_EMAIL with full context.
 * Failsafes (only fire when primary fails — kept off the happy path so
 * normal escalations don't double-notify):
 *   1. Post the same context to the team Slack channel via the existing
 *      webhook (no per-uid rate-limit — escalation is privileged).
 *   2. SMTP send to support@convohub.dev as a permanent inbox copy.
 *
 * Every attempt is recorded on the investigationRequests row so the
 * webmaster can audit which hops actually delivered.
 */
// (ESCALATION_FALLBACK_EMAIL removed — failsafe SMTP path is gone.)

// (postEscalationToSlack + postEscalationToFailsafeEmail removed —
// escalations now flow exclusively into the in-app notifications queue.)

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

  const ref = await db.collection("escalationRequests").add({
    requestType: "conversation-investigation",
    conversationId,
    customerName,
    reason,
    requesterUid: uid,
    requesterEmail: userData.email ?? null,
    requesterName: userData.displayName ?? null,
    notifiedEmail: null,
    emailSent: false,
    deliveryChannel: "in-app-notifications",
    status: "pending",
    log: [
      {
        action: "created",
        channel: "pending-escalation-queue",
        at: admin.firestore.Timestamp.now(),
        byUid: uid,
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Email + failsafe SMTP path is gone — escalations now flow into the
  // webmasters' in-app notifications queue exclusively. The bell badge +
  // /notifications page surface them in real time without depending on SMTP.
  const requesterLabel = userData.displayName || userData.email || uid;
  const title = `Investigation requested${customerName ? ` — ${customerName}` : ""}`;
  const description =
    `${requesterLabel} is asking for review of conversation ${conversationId}` +
    `${customerName ? ` with ${customerName}` : ""}.` +
    (reason ? ` Reason: ${reason}` : "");

  const { delivered, error } = await notifyWebmastersInApp({
    type: "alert",
    title,
    description,
    link: `/conversations?id=${encodeURIComponent(conversationId)}`,
  });

  await ref.update({
    notifiedWebmasters: delivered,
    log: admin.firestore.FieldValue.arrayUnion({
      action: "notified-webmasters",
      channel: "in-app-notifications",
      delivered,
      at: admin.firestore.Timestamp.now(),
    }),
    ...(error ? { notifyError: error } : {}),
  });

  return {
    ok: true,
    requestId: ref.id,
    notified: delivered,
    notifyError: error,
    delivered: delivered > 0,
    // Legacy fields kept so older browser bundles don't crash on missing keys.
    emailSent: false,
    emailError: null,
    fallbackSlackSent: false,
    fallbackEmailSent: false,
  };
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
    const oldRole = beforeData?.role ?? "agent";
    const ALLOWED_BASELINES = new Set(["agent", "admin"]);

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
      // CREATE: force a baseline role. New signups should be "agent"; legacy
      // "admin" is also accepted (existing accounts). Anything else gets
      // demoted to "agent".
      if (typeof newRole !== "string" || !ALLOWED_BASELINES.has(newRole)) {
        updates.role = "agent";
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

// =============================================================================
// Inbound channel webhooks — Slack, Gmail
//
// Each webhook validates the provider signature, dedupes on a stable external
// id, and writes a Firestore `conversations` doc (creating one per customer)
// plus a message into the `conversations/{id}/messages` subcollection. The
// rest of the app (Conversations, Analytics, Agent Logs) consumes Firestore
// directly, so once a doc lands here it shows up everywhere instantly.
//
// Conversation shape written:
//   { customerName, customerEmail?, customerPhone?, channel,
//     lastMessage, status: "active", unread: true, timestamp,
//     externalId, externalSource, archived: false }
//
// Dedup key: `externalId` (Slack channel id) so repeat
// messages from the same customer append to the same thread instead of
// creating new conversations.
// =============================================================================

import * as crypto from "crypto";

/**
 * Find an existing open conversation for a given external id (Slack channel
 * or phone number). If none exists, create one and return its ref.
 */
async function findOrCreateConversation(opts: {
  externalId: string;
  externalSource: "slack" | "gmail";
  channel: "slack" | "sms" | "phone" | "email";
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  lastMessage: string;
  /**
   * For Slack: the customer's original message ts. Stamped onto the
   * conversation doc when it's first created so subsequent agent replies
   * thread under the original message via Slack's `thread_ts` instead of
   * starting a brand new top-level thread.
   */
  slackThreadTs?: string;
}): Promise<FirebaseFirestore.DocumentReference> {
  const existing = await db
    .collection("conversations")
    .where("externalId", "==", opts.externalId)
    .where("status", "in", ["active", "waiting"])
    .limit(1)
    .get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.update({
      lastMessage: opts.lastMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      unread: true,
    });
    return ref;
  }
  return db.collection("conversations").add({
    customerName: opts.customerName,
    customerEmail: opts.customerEmail ?? "",
    customerPhone: opts.customerPhone ?? "",
    channel: opts.channel,
    lastMessage: opts.lastMessage,
    status: "active",
    unread: true,
    archived: false,
    externalId: opts.externalId,
    externalSource: opts.externalSource,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    // Only stamp slackThreadTs on creation. We never overwrite an existing
    // value on later inbound messages — the very first customer ts is the
    // canonical thread anchor.
    ...(opts.slackThreadTs ? { slackThreadTs: opts.slackThreadTs } : {}),
  });
}

// -----------------------------------------------------------------------------
// Slack Events API webhook
// Setup: create a custom Slack app at https://api.slack.com/apps using
// the manifest in /docs/slack-app-manifest.json (after deploy, paste the
// function URL into the manifest's request_url field). Required env vars:
//   SLACK_SIGNING_SECRET — verifies inbound requests
//   SLACK_BOT_TOKEN      — used later for replying back into Slack (not used
//                          in this inbound flow, but stored for symmetry)
// Subscribe to these bot events: message.im, app_mention, message.channels
// -----------------------------------------------------------------------------
export const slackEvents = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      logger.error("slackEvents: SLACK_SIGNING_SECRET not configured");
      res.status(500).send("Server not configured");
      return;
    }

    // 1. Validate Slack signature: v0=HMAC_SHA256(signing_secret, "v0:" + ts + ":" + body)
    const signature = req.header("x-slack-signature") || "";
    const timestamp = req.header("x-slack-request-timestamp") || "";
    const rawBody: string =
      typeof (req as unknown as { rawBody?: Buffer }).rawBody !== "undefined"
        ? (req as unknown as { rawBody: Buffer }).rawBody.toString("utf8")
        : JSON.stringify(req.body ?? {});

    // Reject replays older than 5 minutes.
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) {
      res.status(401).send("Stale request");
      return;
    }
    const expected =
      "v0=" +
      crypto
        .createHmac("sha256", signingSecret)
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn("slackEvents: signature mismatch");
      res.status(401).send("Invalid signature");
      return;
    }

    const body = req.body as { type?: string; challenge?: string; event?: any };

    // 2. URL verification handshake (one-time, when configuring the app).
    if (body.type === "url_verification" && typeof body.challenge === "string") {
      res.status(200).json({ challenge: body.challenge });
      return;
    }

    // 3. Event callback — only act on user-authored message-like events.
    if (body.type === "event_callback" && body.event) {
      const event = body.event as {
        type?: string;
        text?: string;
        user?: string;
        bot_id?: string;
        channel?: string;
        ts?: string;
        team?: string;
      };
      // Skip bot echoes and edits/deletes — only accept user messages.
      if (event.bot_id || !event.user || !event.text || !event.channel) {
        res.status(200).send("ignored");
        return;
      }
      try {
        // Resolve the user's display name (best effort) via users.info.
        let displayName = event.user;
        const botToken = process.env.SLACK_BOT_TOKEN;
        if (botToken) {
          try {
            const r = await fetch(`https://slack.com/api/users.info?user=${event.user}`, {
              headers: { Authorization: `Bearer ${botToken}` },
            });
            const j = (await r.json()) as { ok?: boolean; user?: { real_name?: string; profile?: { display_name?: string } } };
            if (j.ok && j.user) {
              displayName = j.user.profile?.display_name || j.user.real_name || event.user;
            }
          } catch (e) {
            logger.warn("slackEvents: users.info lookup failed", e);
          }
        }

        const externalId = `slack:${event.channel}`;
        const convoRef = await findOrCreateConversation({
          externalId,
          externalSource: "slack",
          channel: "slack",
          customerName: displayName,
          lastMessage: event.text.slice(0, 500),
          // Pass the customer's original ts so a brand-new conversation gets
          // it stamped as slackThreadTs on creation. For existing convos the
          // helper ignores it (we never want to overwrite the anchor).
          slackThreadTs: typeof event.ts === "string" ? event.ts : undefined,
        });
        await convoRef.collection("messages").add({
          sender: "customer",
          text: event.text,
          channel: "slack",
          externalTs: event.ts ?? null,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        logger.error("slackEvents: failed to write conversation", err);
        // Still 200 so Slack doesn't retry forever; we logged for inspection.
      }
    }

    res.status(200).send("ok");
  }
);

// (Twilio inbound webhook + signature helpers removed — Google Voice is
// the only SMS/Voice path now and it does not run through this backend.)

// -----------------------------------------------------------------------------
// Gmail → ConvoHub: callable used by /gmail-api 'Push to ConvoHub' button.
// The browser already holds a Gmail OAuth token (Google Identity Services),
// so we don't run Gmail OAuth server-side. The client simply hands us the
// already-fetched message fields and we write the Firestore docs with proper
// dedup. This avoids Pub/Sub watch + topic setup for a single-tenant app.
// -----------------------------------------------------------------------------
export const pushGmailMessageToConvoHub = onCall(async (request) => {
  // Wrap the entire body in a try/catch so any unexpected throw becomes a
  // structured `HttpsError` instead of the generic "internal" the SDK
  // surfaces by default — that opaque "internal" was the user-visible
  // "Push to ConvoHub failed internally" toast.
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");

    const data = (request.data ?? {}) as {
      messageId?: unknown;
      threadId?: unknown;
      from?: unknown;
      fromEmail?: unknown;
      subject?: unknown;
      snippet?: unknown;
    };
    const messageId = typeof data.messageId === "string" ? data.messageId : "";
    const threadId = typeof data.threadId === "string" ? data.threadId : messageId;
    const from = typeof data.from === "string" ? data.from.slice(0, 200) : "";
    const fromEmail = typeof data.fromEmail === "string" ? data.fromEmail.slice(0, 200) : "";
    const subject = typeof data.subject === "string" ? data.subject.slice(0, 300) : "";
    const snippet = typeof data.snippet === "string" ? data.snippet.slice(0, 1000) : "";

    if (!messageId || !from) {
      throw new HttpsError("invalid-argument", "messageId and from are required.");
    }

    // ---- Dedup ---------------------------------------------------------------
    // BUG FIX: the previous dup-check queried `externalId == "gmail:${messageId}"`
    // but `findOrCreateConversation` writes `"gmail-thread:${threadId}"`. The
    // keys never matched, so messages were re-imported on every click and
    // races between concurrent pushes spawned duplicate conversations.
    //
    // We now check both the message-level (`gmail-msg:{id}`) and thread-level
    // (`gmail-thread:{id}`) keys. The thread-level lookup also inspects the
    // `importedGmailMessages` map so we treat any prior import of *this*
    // message id within an existing thread as a no-op.
    const externalThreadId = `gmail-thread:${threadId}`;
    const externalMessageId = `gmail-msg:${messageId}`;
    const dupByMessage = await db
      .collection("conversations")
      .where("externalId", "==", externalMessageId)
      .limit(1)
      .get();
    if (!dupByMessage.empty) {
      return { ok: true, alreadyImported: true, conversationId: dupByMessage.docs[0].id };
    }
    const dupByThread = await db
      .collection("conversations")
      .where("externalId", "==", externalThreadId)
      .limit(1)
      .get();
    if (!dupByThread.empty) {
      const existing = dupByThread.docs[0];
      const importedMap = (existing.data() as { importedGmailMessages?: Record<string, boolean> })
        .importedGmailMessages || {};
      if (importedMap[messageId]) {
        return { ok: true, alreadyImported: true, conversationId: existing.id };
      }
    }

    // ---- Create / append -----------------------------------------------------
    let convoRef: FirebaseFirestore.DocumentReference;
    try {
      convoRef = await findOrCreateConversation({
        externalId: externalThreadId,
        externalSource: "gmail",
        channel: "email",
        customerName: from.replace(/<[^>]+>/, "").trim() || fromEmail || from,
        customerEmail: fromEmail,
        lastMessage: subject ? `${subject}: ${snippet}` : snippet || "(no preview)",
      });
    } catch (err) {
      logger.error("pushGmailMessageToConvoHub: findOrCreateConversation failed", {
        err: (err as Error).message,
        messageId,
        threadId,
      });
      throw new HttpsError(
        "internal",
        `Could not create or open the conversation: ${(err as Error).message}`
      );
    }

    try {
      await convoRef.collection("messages").add({
        sender: "customer",
        text: snippet || subject || "(empty Gmail message)",
        subject,
        channel: "email",
        gmailMessageId: messageId,
        gmailThreadId: threadId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      await convoRef.update({ [`importedGmailMessages.${messageId}`]: true });
    } catch (err) {
      logger.error("pushGmailMessageToConvoHub: message append failed", {
        err: (err as Error).message,
        convoId: convoRef.id,
        messageId,
      });
      throw new HttpsError(
        "internal",
        `Conversation created but the Gmail message could not be appended: ${(err as Error).message}`
      );
    }

    logger.info("pushGmailMessageToConvoHub: imported", {
      by: request.auth.uid,
      messageId,
      threadId,
      convoId: convoRef.id,
    });
    return { ok: true, conversationId: convoRef.id, alreadyImported: false };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("pushGmailMessageToConvoHub: unhandled", err);
    throw new HttpsError("internal", `Push to ConvoHub failed: ${(err as Error).message}`);
  }
});

// -----------------------------------------------------------------------------
// Outbound Slack reply: callable invoked from /conversations when an agent
// sends a reply on a Slack-channel conversation. Posts the reply back to the
// originating Slack channel via chat.postMessage so the customer sees it in
// Slack instead of just inside ConvoHub.
//
// Required env: SLACK_BOT_TOKEN (xoxb-…) — the same token used by the Events
// webhook for users.info lookups. The bot must be a member of the target
// channel for chat.postMessage to succeed (Slack returns "not_in_channel"
// otherwise).
//
// Request: { conversationId: string, text: string, threadTs?: string,
//            agentName?: string }
// Resolves the Slack channel id by reading the conversation's `externalId`
// field (format: "slack:CXXXXXXXX") so the client never has to know it.
// -----------------------------------------------------------------------------
export const replyToSlackChannel = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");

  const data = (request.data ?? {}) as {
    conversationId?: unknown;
    text?: unknown;
    threadTs?: unknown;
    agentName?: unknown;
  };
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const threadTs = typeof data.threadTs === "string" && data.threadTs ? data.threadTs : undefined;
  const agentName = typeof data.agentName === "string" ? data.agentName.slice(0, 80) : "Agent";
  if (!conversationId) throw new HttpsError("invalid-argument", "conversationId required.");
  if (!text) throw new HttpsError("invalid-argument", "text required.");
  if (text.length > 4000) throw new HttpsError("invalid-argument", "text too long (max 4000 chars).");

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new HttpsError("failed-precondition", "SLACK_BOT_TOKEN is not configured on the server.");
  }

  // Resolve the Slack channel from the conversation document so the channel
  // id is never trusted from the client.
  const convoSnap = await db.doc(`conversations/${conversationId}`).get();
  if (!convoSnap.exists) throw new HttpsError("not-found", "Conversation not found.");
  const convo = convoSnap.data() as {
    externalId?: string;
    externalSource?: string;
    channel?: string;
    slackThreadTs?: string;
  };
  if (convo.channel !== "slack" || convo.externalSource !== "slack") {
    throw new HttpsError("failed-precondition", "Conversation is not a Slack thread.");
  }
  const externalId = convo.externalId || "";
  const channelId = externalId.startsWith("slack:") ? externalId.slice("slack:".length) : "";
  if (!channelId) throw new HttpsError("failed-precondition", "Conversation is missing a Slack channel id.");

  // Thread continuity: prefer an explicit threadTs from the caller; otherwise
  // reuse the ts we recorded the first time we posted to (or received from)
  // this channel. This keeps every agent reply nested under the original
  // Slack message instead of cluttering the channel with top-level posts.
  const effectiveThreadTs = threadTs || convo.slackThreadTs || undefined;

  // Strip control characters defensively before forwarding to Slack.
  const safeText = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  const payload: Record<string, unknown> = {
    channel: channelId,
    text: `*${agentName}:* ${safeText}`,
    ...(effectiveThreadTs ? { thread_ts: effectiveThreadTs } : {}),
  };

  let slackJson: { ok?: boolean; ts?: string; error?: string; channel?: string };
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    slackJson = (await r.json()) as { ok?: boolean; ts?: string; error?: string; channel?: string };
  } catch (err) {
    logger.error("replyToSlackChannel: fetch failed", err);
    throw new HttpsError("internal", `Slack request failed: ${(err as Error).message}`);
  }

  if (!slackJson.ok) {
    logger.warn("replyToSlackChannel: Slack returned error", { error: slackJson.error, channelId });
    throw new HttpsError("internal", `Slack error: ${slackJson.error || "unknown"}`);
  }

  // Persist the very first ts we see on this conversation so future replies
  // can use it as thread_ts. Don't overwrite an existing value (the inbound
  // Slack webhook may have already recorded the customer's original ts).
  if (slackJson.ts && !convo.slackThreadTs) {
    try {
      await convoSnap.ref.update({ slackThreadTs: slackJson.ts });
    } catch (err) {
      // Non-fatal — the message is already in Slack; we just lose threading
      // continuity for the next reply.
      logger.warn("replyToSlackChannel: failed to record slackThreadTs", err);
    }
  }

  logger.info("replyToSlackChannel: posted", {
    by: request.auth.uid,
    conversationId,
    channelId,
    ts: slackJson.ts,
    threadTs: effectiveThreadTs ?? null,
  });
  return {
    ok: true,
    ts: slackJson.ts ?? null,
    threadTs: effectiveThreadTs ?? slackJson.ts ?? null,
    channel: slackJson.channel ?? channelId,
  };
});

// =============================================================================
// integrationsHealthCheck — webmaster-only ping of every connected provider
// so the /integrations page can show a green/red dot per integration without
// the user having to leave the app or hand-test each credential.
//
// We deliberately make a single, harmless read-only API call per provider:
//   • Slack    → auth.test           (verifies SLACK_BOT_TOKEN)
//   • Gmail    → users/me/profile    (uses caller's OAuth access token)
//   • Google   → config presence    (no public REST API — we surface whether
//     Voice          the per-user webhook secret + voice number are configured
//                    in Firestore so the dashboard isn't silently empty)
//
// Both the on-demand callable and the every-5-days scheduled job persist
// the latest run to `system/integrationsHealth` so the AppSidebar/BottomNav
// can show a red dot on the Integrations link when any provider fails,
// without the webmaster having to open /integrations to find out.
// =============================================================================
type ProviderResult = { ok: boolean; message: string; latencyMs: number };
type HealthRunSource = "manual" | "scheduled";

async function runHealthChecks(opts: {
  /** GIS access token for the Gmail check. Null when running unattended. */
  gmailAccessToken: string | null;
  /**
   * UID whose integrations doc to consult for the Google Voice check.
   * For the manual flow this is the caller; for the scheduled flow the
   * caller picks the first webmaster with a configured voice number.
   */
  voiceConfigUid: string | null;
}): Promise<Record<string, ProviderResult>> {
  const results: Record<string, ProviderResult> = {};
  const time = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };

  // ---------- Slack ----------
  try {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      results.slack = { ok: false, message: "SLACK_BOT_TOKEN not configured", latencyMs: 0 };
    } else {
      const { value: r, ms } = await time(() =>
        fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: { Authorization: `Bearer ${botToken}` },
        })
      );
      const j = (await r.json()) as { ok?: boolean; team?: string; user?: string; error?: string };
      results.slack = j.ok
        ? { ok: true, message: `Connected as @${j.user} on ${j.team}`, latencyMs: ms }
        : { ok: false, message: `Slack error: ${j.error || "unknown"}`, latencyMs: ms };
    }
  } catch (err) {
    results.slack = { ok: false, message: `Slack request failed: ${(err as Error).message}`, latencyMs: 0 };
  }

  // ---------- Gmail ----------
  try {
    if (!opts.gmailAccessToken) {
      results.gmail = {
        ok: false,
        message: "Open Gmail API page once to refresh your OAuth token, then retry.",
        latencyMs: 0,
      };
    } else {
      const { value: r, ms } = await time(() =>
        fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${opts.gmailAccessToken}` },
        })
      );
      const j = (await r.json()) as { emailAddress?: string; error?: { message?: string } };
      if (r.ok && j.emailAddress) {
        results.gmail = { ok: true, message: `Token valid for ${j.emailAddress}`, latencyMs: ms };
      } else {
        results.gmail = {
          ok: false,
          message: `Gmail error: ${j.error?.message || `HTTP ${r.status}`}`,
          latencyMs: ms,
        };
      }
    }
  } catch (err) {
    results.gmail = { ok: false, message: `Gmail request failed: ${(err as Error).message}`, latencyMs: 0 };
  }

  // ---------- Google Voice ----------
  // Google does not expose a public Voice REST API, so the live ping is
  // limited to confirming a webmaster has stored a Voice number on their
  // integrations doc. Surface that presence so the dashboard isn't silently
  // empty; deeper liveness checks would require Google Workspace admin SDK.
  try {
    let configuredNumber: string | null = null;
    if (opts.voiceConfigUid) {
      const integSnap = await db
        .doc(`users/${opts.voiceConfigUid}/integrations/credentials`)
        .get();
      const gv =
        ((integSnap.data() as Record<string, { connected?: boolean; fields?: Record<string, string> }> | undefined)?.[
          "google-voice"
        ]) || null;
      configuredNumber = gv?.connected && gv.fields?.voiceNumber ? gv.fields.voiceNumber : null;
    }
    results["google-voice"] = configuredNumber
      ? {
          ok: true,
          message: `Voice number ${configuredNumber} configured on a webmaster account.`,
          latencyMs: 0,
        }
      : {
          ok: false,
          message: "No Google Voice number configured on any webmaster account.",
          latencyMs: 0,
        };
  } catch (err) {
    results["google-voice"] = {
      ok: false,
      message: `Voice check failed: ${(err as Error).message}`,
      latencyMs: 0,
    };
  }

  return results;
}

/**
 * Persist the latest run to `system/integrationsHealth` so navs can read it,
 * AND append a row to `integrationsHealthHistory/{autoId}` so the
 * /integrations panel can show a "last 5 runs" trend without scraping logs.
 */
async function persistHealthSummary(
  results: Record<string, ProviderResult>,
  source: HealthRunSource,
  triggeredByUid: string | null
): Promise<void> {
  const failingProviders = Object.entries(results)
    .filter(([, r]) => !r.ok)
    .map(([id]) => id);
  const checkedAtMs = Date.now();
  const summary = {
    results,
    failingProviders,
    anyFailing: failingProviders.length > 0,
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    checkedAtMs,
    source,
    triggeredByUid,
  };
  await db.doc("system/integrationsHealth").set(summary);
  // Append-only history row (best-effort — never fails the parent run).
  try {
    await db.collection("integrationsHealthHistory").add({
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      checkedAtMs,
      source,
      triggeredByUid,
      failingProviders,
      anyFailing: failingProviders.length > 0,
      providerCount: Object.keys(results).length,
    });
  } catch (err) {
    logger.warn("integrationsHealthHistory append failed", err);
  }
}

export const integrationsHealthCheck = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  const callerRole = (callerSnap.data() as { role?: string } | undefined)?.role;
  if (callerRole !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { gmailAccessToken?: unknown };
  const gmailAccessToken =
    typeof data.gmailAccessToken === "string" && data.gmailAccessToken
      ? data.gmailAccessToken
      : null;

  const results = await runHealthChecks({
    gmailAccessToken,
    voiceConfigUid: request.auth.uid,
  });

  // Persist so the sidebar/bottom-nav indicator updates immediately for
  // every signed-in webmaster, not just the one who clicked the button.
  try {
    await persistHealthSummary(results, "manual", request.auth.uid);
  } catch (err) {
    logger.warn("integrationsHealthCheck: failed to persist summary", err);
  }

  return { ok: true, results, checkedAt: Date.now() };
});

// -----------------------------------------------------------------------------
// runIntegrationsHealthCheckScheduled — runs unattended every 5 days. Stores
// the result in `system/integrationsHealth` so the AppSidebar/BottomNav can
// surface a red dot on the Integrations link when any provider fails. No
// Gmail token is available in this context, so Gmail will report "open Gmail
// API to refresh" — that's intentional and surfaces stale OAuth.
// -----------------------------------------------------------------------------
// Shared body so the scheduled timer and the QA "trigger now" callable run
// the exact same path — including persisting the summary with source:"scheduled".
async function runScheduledHealthCheckBody(): Promise<{
  results: Record<string, { ok: boolean; message: string; latencyMs: number }>;
  failing: string[];
}> {
  // Find any webmaster with a configured Google Voice number so the
  // unattended Voice check has somewhere to look. Falls back to "no voice
  // number configured" if none found — which is itself useful signal.
  let voiceConfigUid: string | null = null;
  try {
    const webmasters = await db.collection("users").where("role", "==", "webmaster").get();
    for (const w of webmasters.docs) {
      const credSnap = await db.doc(`users/${w.id}/integrations/credentials`).get();
      const gv =
        ((credSnap.data() as Record<string, { connected?: boolean; fields?: Record<string, string> }> | undefined)?.[
          "google-voice"
        ]) || null;
      if (gv?.connected && gv.fields?.voiceNumber) {
        voiceConfigUid = w.id;
        break;
      }
    }
  } catch (err) {
    logger.warn("scheduled health check: webmaster lookup failed", err);
  }

  const results = await runHealthChecks({ gmailAccessToken: null, voiceConfigUid });
  await persistHealthSummary(results, "scheduled", null);
  const failing = Object.entries(results).filter(([, r]) => !r.ok).map(([id]) => id);
  return { results, failing };
}

export const runIntegrationsHealthCheckScheduled = onSchedule(
  { schedule: "every 120 hours", timeZone: "Etc/UTC", region: "us-central1" },
  async () => {
    const { results, failing } = await runScheduledHealthCheckBody();
    logger.info("scheduled health check complete", {
      failing,
      okCount: Object.values(results).filter((r) => r.ok).length,
    });
  }
);

// QA hook: lets admins/webmasters trigger the unattended path on demand so
// the every-5-days timer can be validated without waiting. Mirrors the
// scheduled job exactly (no Gmail token, source: "scheduled").
export const triggerScheduledHealthCheckNow = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  const callerRole = (callerSnap.data() as { role?: string } | undefined)?.role;
  if (callerRole !== "webmaster" && callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Webmaster or admin only.");
  }
  const { results, failing } = await runScheduledHealthCheckBody();
  logger.info("manual-trigger scheduled health check complete", {
    triggeredBy: request.auth.uid,
    failing,
  });
  return { ok: true, results, failing, checkedAt: Date.now() };
});


// =============================================================================
// Slack alert proxy — keeps the webhook URL out of the browser bundle
// =============================================================================
//
// Background: the on-call webmaster's Slack incoming-webhook URL was previously
// stored in `appSettings/webmasterContact.slackWebhookUrl` and read directly by
// every signed-in client. That worked, but any agent could open devtools, copy
// the URL, and spam the channel from outside the app. Moving the network call
// server-side lets us:
//
//   1. Hide the webhook URL — only this function (admin SDK) ever sees it.
//   2. Verify the caller via the Firebase Auth ID token (auto-validated by
//      onCall) AND check their `users/{uid}.role` is agent/admin/webmaster.
//   3. Enforce a 10-minute per-uid rate limit so a stressed agent can't fan
//      out 10 pings in a row by accident.
//   4. Append every successful press to `webmasterContactEvents` with channel
//      'slack-alert', so the /settings history shows it alongside Call/Text.
//
// The companion doc `appSettings/slackAlertStatus` is written by the
// `setSlackWebhookUrlAdmin` callable and exposes only `{ configured: bool }`
// to all signed-in users so the SlackAlertButton can render a disabled state
// without leaking the URL itself.

const SLACK_ALERT_RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const FIXED_SLACK_ALERT_MESSAGE =
  "Someone on the ConvoHub team has pinged this channel for review. Please review or grab Kit for scanning.";

function safeForSlack(s: string): string {
  return String(s).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 240);
}

/**
 * Read the team-wide Slack webhook URL. Prefers the runtime env var
 * `SLACK_WEBHOOK_URL` (set via `firebase functions:secrets:set` or in the
 * deploy environment) and falls back to the Firestore-stored value for
 * backward compat with the existing /settings UI. Returns null when neither
 * is configured.
 */
async function readSlackWebhookUrl(): Promise<string | null> {
  const fromEnv = (process.env.SLACK_WEBHOOK_URL || "").trim();
  if (fromEnv && fromEnv.startsWith("https://hooks.slack.com/")) return fromEnv;

  try {
    const snap = await db.doc("appSettings/webmasterContact").get();
    const url = ((snap.data() as { slackWebhookUrl?: string } | undefined)?.slackWebhookUrl || "").trim();
    if (url && url.startsWith("https://hooks.slack.com/")) return url;
  } catch (err) {
    logger.warn("readSlackWebhookUrl: Firestore read failed", err);
  }
  return null;
}

/**
 * Admin/webmaster-only: store the team's Slack incoming-webhook URL
 * server-side. Writes the URL to `appSettings/webmasterContact` (admin/wm
 * read-only via rules) AND a public-readable status doc so every client can
 * see whether alerts are wired up without seeing the secret.
 *
 * Request: { url: string }  // empty string clears the configuration
 */
export const setSlackWebhookUrlAdmin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerData = callerSnap.data() as { role?: string; email?: string } | undefined;
  if (callerData?.role !== "webmaster" && callerData?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admins or webmasters only.");
  }

  const data = (request.data ?? {}) as { url?: unknown };
  const raw = typeof data.url === "string" ? data.url.trim() : "";
  if (raw && !raw.startsWith("https://hooks.slack.com/")) {
    throw new HttpsError("invalid-argument", "URL must start with https://hooks.slack.com/");
  }

  await db.doc("appSettings/webmasterContact").set(
    {
      slackWebhookUrl: raw,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: callerUid,
    },
    { merge: true }
  );

  // Public-readable mirror: only the boolean leaves Firestore — never the URL.
  await db.doc("appSettings/slackAlertStatus").set(
    {
      configured: !!raw,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: callerUid,
      updatedByEmail: callerData?.email ?? null,
    },
    { merge: true }
  );

  logger.info("setSlackWebhookUrlAdmin", { by: callerUid, configured: !!raw });
  return { ok: true, configured: !!raw };
});

/**
 * Any signed-in user (agent/admin/webmaster) can fire a Slack alert. The
 * function:
 *   1. Verifies the caller's profile + role.
 *   2. Enforces a 10-minute per-uid cooldown via a transactional write to
 *      `slackAlertRateLimits/{uid}`.
 *   3. POSTs the fixed review message to the team Slack webhook.
 *   4. Appends a `webmasterContactEvents` row (channel: 'slack-alert').
 *
 * Returns: { ok, sentAt, nextAllowedAt }
 * Throws:  resource-exhausted (with details.retryAt) when rate-limited,
 *          failed-precondition when no webhook is configured.
 */
export const pingWebmasterSlack = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Profile missing.");
  const userData = userSnap.data() as { role?: string; displayName?: string; email?: string };
  const role = userData.role;
  if (role !== "agent" && role !== "admin" && role !== "webmaster") {
    throw new HttpsError("permission-denied", "Account role is not authorized to send Slack alerts.");
  }

  const data = (request.data ?? {}) as { route?: unknown };
  const route = typeof data.route === "string" ? safeForSlack(data.route) : "/";

  // ---- Rate limit (transactional read-modify-write) --------------------------
  const rateLimitRef = db.doc(`slackAlertRateLimits/${uid}`);
  const now = Date.now();
  const nextAllowedAt = now + SLACK_ALERT_RATE_LIMIT_MS;

  const rateOk = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const lastMs = snap.exists
      ? ((snap.data() as { lastSentMs?: number }).lastSentMs ?? 0)
      : 0;
    if (lastMs && now - lastMs < SLACK_ALERT_RATE_LIMIT_MS) {
      return { allowed: false as const, retryAt: lastMs + SLACK_ALERT_RATE_LIMIT_MS };
    }
    tx.set(rateLimitRef, {
      lastSentMs: now,
      lastRoute: route,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { allowed: true as const, retryAt: nextAllowedAt };
  });

  if (!rateOk.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Slack alert rate limit hit. Try again at ${new Date(rateOk.retryAt).toISOString()}.`,
      { retryAt: rateOk.retryAt }
    );
  }

  // ---- Resolve webhook URL ---------------------------------------------------
  const webhookUrl = await readSlackWebhookUrl();
  if (!webhookUrl) {
    // Roll back the rate-limit write so the user isn't penalised for a
    // misconfiguration outside their control.
    await rateLimitRef.delete().catch(() => undefined);
    throw new HttpsError(
      "failed-precondition",
      "Slack webhook is not configured. Ask an admin or webmaster to set it on Settings."
    );
  }

  // ---- POST to Slack ---------------------------------------------------------
  const slackBody = { text: FIXED_SLACK_ALERT_MESSAGE };

  let slackOk = true;
  let slackError: string | null = null;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackBody),
    });
    if (!res.ok) {
      slackOk = false;
      const body = await res.text().catch(() => "");
      slackError = `Slack webhook rejected the test ping (${res.status}${body ? `: ${safeForSlack(body)}` : ""}).`;
      logger.warn("pingWebmasterSlack: Slack returned non-2xx", {
        status: res.status,
        uid,
      });
    }
  } catch (err) {
    slackOk = false;
    slackError = `Slack webhook request failed: ${(err as Error).message}`;
    logger.error("pingWebmasterSlack: fetch failed", err);
  }

  // ---- Append to the contact-events history (channel: 'slack-alert') --------
  // We log even when the Slack POST failed so the webmaster can see
  // attempted alerts and the rate-limit metering matches reality.
  try {
    await db.collection("webmasterContactEvents").add({
      agentUid: uid,
      agentName: safeForSlack(userData.displayName || "Unknown"),
      channel: "slack-alert",
      route,
      slackOk,
      slackError,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("pingWebmasterSlack: contact-event log failed", err);
  }

  if (!slackOk) {
    await rateLimitRef.delete().catch(() => undefined);
    throw new HttpsError("internal", slackError || "Slack delivery failed.");
  }

  logger.info("pingWebmasterSlack: sent", { uid, route });
  return { ok: true, sentAt: now, nextAllowedAt };
});

// =============================================================================
// Provision Support — clone caller's integrations + UI prefs into another uid
// =============================================================================
//
// Webmaster-only. Used by the "Provision Support" card on /settings to seed
// the support@convohub.dev account with the same Slack/Gmail credentials and
// background-ingestion preferences as the calling webmaster, so the Support
// operator can hit the ground running without re-entering anything.
//
// We do this server-side because Firestore rules block cross-user writes —
// only the admin SDK can write into another user's `users/{uid}/...` subtree.
//
// Request:  { targetEmail?: string }   (defaults to support@convohub.dev)
// Response: { ok, targetUid, clonedIntegrations, clonedPrefs }
export const cloneIntegrationsToSupport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerData = callerSnap.data() as { role?: string; email?: string } | undefined;
  if (callerData?.role !== "webmaster") {
    throw new HttpsError("permission-denied", "Webmasters only.");
  }

  const data = (request.data ?? {}) as { targetEmail?: unknown };
  const targetEmail =
    typeof data.targetEmail === "string" && data.targetEmail.trim()
      ? data.targetEmail.trim().toLowerCase()
      : "support@convohub.dev";

  const targetQuery = await db.collection("users").where("email", "==", targetEmail).limit(1).get();
  if (targetQuery.empty) {
    throw new HttpsError(
      "not-found",
      `No user with email ${targetEmail}. Have them sign up first, then retry.`
    );
  }
  const targetDoc = targetQuery.docs[0];
  const targetUid = targetDoc.id;
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "Cannot clone into your own account.");
  }

  // ---- Clone integrations credentials doc -----------------------------------
  // Path: users/{uid}/integrations/credentials  (single doc, fields per integration)
  let clonedIntegrations = false;
  try {
    const srcSnap = await db.doc(`users/${callerUid}/integrations/credentials`).get();
    if (srcSnap.exists) {
      const payload = srcSnap.data() ?? {};
      await db.doc(`users/${targetUid}/integrations/credentials`).set(
        { ...payload, _clonedFromUid: callerUid, _clonedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      clonedIntegrations = true;
    }
  } catch (err) {
    logger.error("cloneIntegrationsToSupport: integrations clone failed", err);
  }

  // ---- Clone UI prefs doc (e.g. bgGmailIngest) ------------------------------
  // Path: users/{uid}/prefs/ui
  let clonedPrefs = false;
  try {
    const srcSnap = await db.doc(`users/${callerUid}/prefs/ui`).get();
    if (srcSnap.exists) {
      const payload = srcSnap.data() ?? {};
      await db.doc(`users/${targetUid}/prefs/ui`).set(
        { ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      clonedPrefs = true;
    }
  } catch (err) {
    logger.error("cloneIntegrationsToSupport: prefs clone failed", err);
  }

  // Audit trail.
  await db.collection("roleGrants").add({
    targetUid,
    targetEmail,
    action: "cloneIntegrationsToSupport",
    clonedIntegrations,
    clonedPrefs,
    grantedByUid: callerUid,
    grantedByEmail: callerData?.email ?? null,
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("cloneIntegrationsToSupport: done", {
    targetUid,
    targetEmail,
    clonedIntegrations,
    clonedPrefs,
    by: callerUid,
  });

  return { ok: true, targetUid, targetEmail, clonedIntegrations, clonedPrefs };
});

// =============================================================================
// Embeddable customer chat widget
// =============================================================================
//
// `createWidgetConversation` (HTTP, public CORS) creates a new `conversations`
// doc when a visitor submits the widget intake form, records explicit consent,
// and returns a short-lived `visitorToken` the widget then uses to post
// messages. `postWidgetMessage` (HTTP, public CORS) writes customer messages
// to `conversations/{id}/messages`. Staff replies flow through the existing
// authenticated client + Firestore rules unchanged.
//
// Both endpoints are rate-limited by `widgetRateLimits/{visitorToken}` and
// validate input length to keep the surface area small. App Check is not
// required because the widget is meant to embed on arbitrary third-party
// origins; abuse mitigation is rate-limit + validation + per-tenant audit.

import * as crypto from "crypto";

const WIDGET_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const WIDGET_RATE_WINDOW_MS = 60 * 1000;
const WIDGET_RATE_LIMIT = 10;

const widgetCors = (req: any, res: any) => {
  const origin = req.headers.origin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
};

function sanitize(s: unknown, max = 500): string {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export const createWidgetConversation = onRequest({ cors: false }, async (req, res) => {
  widgetCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method-not-allowed" }); return; }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tenantId = sanitize(body.tenantId, 64) || "default";
    const name = sanitize(body.name, 80);
    const email = sanitize(body.email, 254).toLowerCase();
    const phone = sanitize(body.phone, 32);
    const consent = body.consent === true;
    const pageUrl = sanitize(body.pageUrl, 500);

    if (!name) { res.status(400).json({ error: "invalid-argument", message: "Name is required." }); return; }
    if (!isEmail(email)) { res.status(400).json({ error: "invalid-argument", message: "A valid email is required." }); return; }
    if (!consent) { res.status(400).json({ error: "consent-required", message: "Consent to the privacy policy is required." }); return; }

    const visitorId = crypto.randomBytes(16).toString("hex");
    const visitorToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(visitorToken).digest("hex");

    const conversationRef = await db.collection("conversations").add({
      customerName: name,
      customerEmail: email,
      customerPhone: phone || null,
      assignedAgent: null,
      status: "waiting",
      channel: "web",
      source: "web-widget",
      widgetTenantId: tenantId,
      visitorId,
      visitorTokenHash: tokenHash,
      visitorTokenExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + WIDGET_TOKEN_TTL_MS),
      consent: {
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
        userAgent: sanitize(req.headers["user-agent"], 300),
        pageUrl,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      archived: false,
      unreadCount: 0,
    });

    await db.collection("noteAudit").add({
      action: "create",
      type: "widget",
      title: `Web widget thread from ${name}`,
      description: `tenant=${tenantId} email=${email}`,
      actor: "web-widget",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => undefined);

    logger.info("createWidgetConversation: created", { conversationId: conversationRef.id, tenantId });
    res.status(200).json({ ok: true, conversationId: conversationRef.id, visitorId, visitorToken });
  } catch (err) {
    logger.error("createWidgetConversation failed", err);
    res.status(500).json({ error: "internal", message: "Could not create conversation." });
  }
});

export const postWidgetMessage = onRequest({ cors: false }, async (req, res) => {
  widgetCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method-not-allowed" }); return; }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const conversationId = sanitize(body.conversationId, 64);
    const visitorToken = typeof body.visitorToken === "string" ? body.visitorToken : "";
    const text = sanitize(body.body, 2000);
    if (!conversationId || !visitorToken || !text) {
      res.status(400).json({ error: "invalid-argument" }); return;
    }

    const convoSnap = await db.doc(`conversations/${conversationId}`).get();
    if (!convoSnap.exists) { res.status(404).json({ error: "not-found" }); return; }
    const data = convoSnap.data() as any;
    const expectedHash = crypto.createHash("sha256").update(visitorToken).digest("hex");
    if (data.visitorTokenHash !== expectedHash) {
      res.status(403).json({ error: "permission-denied" }); return;
    }
    const exp = data.visitorTokenExpiresAt?.toMillis?.() ?? 0;
    if (exp && exp < Date.now()) {
      res.status(403).json({ error: "token-expired" }); return;
    }

    // Per-token rate limit (10 msg / 60s).
    const rateRef = db.doc(`widgetRateLimits/${expectedHash}`);
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const now = Date.now();
      const arr = ((snap.exists ? (snap.data() as any).timestamps : []) as number[]).filter(
        (t) => now - t < WIDGET_RATE_WINDOW_MS,
      );
      if (arr.length >= WIDGET_RATE_LIMIT) return false;
      arr.push(now);
      tx.set(rateRef, { timestamps: arr, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!allowed) { res.status(429).json({ error: "rate-limited" }); return; }

    await db.collection(`conversations/${conversationId}/messages`).add({
      body: text,
      sender: "customer",
      senderName: data.customerName || "Customer",
      channel: "web",
      direction: "inbound",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    await convoSnap.ref.update({
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: text.slice(0, 140),
      status: data.status === "closed" ? "waiting" : data.status || "waiting",
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("postWidgetMessage failed", err);
    res.status(500).json({ error: "internal" });
  }
});

// =============================================================================
// Privacy / data-subject rights
// =============================================================================

/**
 * Returns a JSON dump of the caller's profile + audit entries they authored.
 * No PII for other users is included. The client downloads the response as a file.
 */
export const exportMyData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;
  const profileSnap = await db.doc(`users/${uid}`).get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Profile not found.");
  const email = (profileSnap.data() as any).email as string | undefined;

  const [noteAudit, peopleAudit, contactEvents, escalations] = await Promise.all([
    db.collection("noteAudit").where("actor", "==", email ?? "__none__").limit(500).get(),
    db.collection("peopleAudit").where("actor", "==", email ?? "__none__").limit(500).get(),
    db.collection("webmasterContactEvents").where("agentUid", "==", uid).limit(500).get(),
    db.collection("escalationRequests").where("requesterUid", "==", uid).limit(200).get(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    profile: { uid, ...profileSnap.data() },
    noteAudit: noteAudit.docs.map((d) => ({ id: d.id, ...d.data() })),
    peopleAudit: peopleAudit.docs.map((d) => ({ id: d.id, ...d.data() })),
    webmasterContactEvents: contactEvents.docs.map((d) => ({ id: d.id, ...d.data() })),
    escalationRequests: escalations.docs.map((d) => ({ id: d.id, ...d.data() })),
  };

  await db.collection("noteAudit").add({
    action: "create",
    type: "privacy",
    title: "Data export generated",
    description: `User ${email ?? uid} downloaded a personal data export.`,
    actor: email ?? uid,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => undefined);

  return { ok: true, data: dump };
});

/**
 * Marks the caller's account for deletion (30-day soft-delete window).
 * Webmasters can self-request only if another webmaster exists.
 */
export const requestAccountDeletion = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = request.auth.uid;
  const profileSnap = await db.doc(`users/${uid}`).get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Profile not found.");
  const profile = profileSnap.data() as any;

  if (profile.role === "webmaster") {
    const others = await db.collection("users").where("role", "==", "webmaster").limit(2).get();
    if (others.size <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "You are the only webmaster. Promote another webmaster before requesting deletion.",
      );
    }
  }

  await profileSnap.ref.update({
    deletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    deletionScheduledFor: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  await db.collection("accountDeletions").add({
    uid,
    email: profile.email ?? null,
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    scheduledFor: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: "pending",
  });

  return { ok: true, scheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
});
