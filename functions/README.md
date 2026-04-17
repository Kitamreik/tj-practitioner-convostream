# ConvoHub Cloud Functions

Server-side enforcement for the ConvoHub Firestore database.

## What it does

### `scheduledArchivePurge`
Runs daily at **03:00 UTC** and permanently deletes archived conversations + their `messages` subcollection, and archived people, that are older than **30 days**. Each run writes a summary to `retentionAudit/`.

### `enforceUserRoleOnWrite`
Firestore trigger on `users/{uid}` that strips any client-supplied `role` field as defense-in-depth. The Firestore rules in `/firestore.rules` already block non-webmaster role writes; this trigger guarantees a runaway client cannot escalate privileges. Trusted server code can set `_serverRoleWrite: true` on the write to bypass the check (the sentinel is auto-deleted).

### `promoteToWebmaster` (callable)
Webmaster-only callable that grants the target user (looked up by email) a new role (`admin` or `webmaster`). Writes use the `_serverRoleWrite` sentinel so `enforceUserRoleOnWrite` accepts them, and an audit row is appended to `roleGrants/`.

```ts
const fn = httpsCallable(functions, "promoteToWebmaster");
await fn({ targetEmail: "user@example.com", role: "webmaster" });
```

### `decideEscalationRequest` (callable)
Webmaster-only. Approves or denies a pending entry in `escalationRequests/`. On approve, sets `escalatedAccess: true` on the requester's profile (server-authored via the `_serverRoleWrite` sentinel).

### `deleteUserAccount` (callable)
Webmaster-only. Deletes the target user from Firebase Auth **and** Firestore. Refuses to delete the caller's own account. Each deletion is appended to `accountDeletions/`.

### `requestConversationInvestigation` (callable)
Any signed-in user. Persists to `investigationRequests/` and emails `kit.tjclasses@gmail.com` (when SMTP is configured) asking a webmaster to investigate a specific conversation.

### Configuring SMTP for outgoing escalation / investigation emails

Both `requestWebmasterEscalation` and `requestConversationInvestigation` send mail to `kit.tjclasses@gmail.com` via SMTP. To enable delivery via Gmail:

1. **Generate a Gmail App Password** (the function cannot use your regular Google password):
   - Sign in to the Google Account that will *send* the emails.
   - Enable 2-Step Verification at https://myaccount.google.com/security if it isn't already on.
   - Go to https://myaccount.google.com/apppasswords
   - Choose **Mail** as the app and **Other (Custom name)** as the device, name it `ConvoHub`, and click **Generate**.
   - Copy the 16-character password (spaces don't matter — Gmail strips them).

2. **Set the secrets on the Firebase project** (run in this `functions/` directory after `firebase login` and `firebase use convo-hub-71514`):
   ```bash
   firebase functions:secrets:set SMTP_HOST   # enter: smtp.gmail.com
   firebase functions:secrets:set SMTP_PORT   # enter: 587
   firebase functions:secrets:set SMTP_USER   # enter: your-sender@gmail.com
   firebase functions:secrets:set SMTP_PASS   # paste the 16-char App Password
   firebase functions:secrets:set SMTP_FROM   # optional, defaults to SMTP_USER
   ```

3. **Bind the secrets to the callables and redeploy**:
   ```bash
   npm run deploy
   ```

   The first deploy will print a one-time prompt asking which functions should access each secret — answer **yes** for `requestWebmasterEscalation`, `requestConversationInvestigation`, and `decideEscalationRequest`.

4. **Verify** by clicking **Request escalation** on the Settings page (as an admin). Within a few seconds the request should appear in `escalationRequests/` with `emailSent: true`, and a notification email should arrive at `kit.tjclasses@gmail.com`. If `emailSent` stays `false`, check `firebase functions:log` for the `sendEscalationEmail failed` line — the most common cause is using a regular Gmail password instead of an App Password.

### `purgeArchivedHttp`
Manual one-off purge trigger:

```bash
curl -X POST https://<region>-<project>.cloudfunctions.net/purgeArchivedHttp \
  -H "Content-Type: application/json" \
  -d '{"secret":"<PURGE_SECRET>"}'
```

## Deploy security rules

```bash
firebase deploy --only firestore:rules
```

The rules file is at the repo root (`firestore.rules`) and locks the `role` field on `users/{uid}` to webmaster-only writes.

## First-time setup

1. Install the Firebase CLI: `npm install -g firebase-tools`
2. From the project root: `firebase login` and `firebase use convo-hub-71514`
3. From this directory:
   ```bash
   cd functions
   npm install
   ```
4. Add the manual-trigger secret (used only for `purgeArchivedHttp`):
   ```bash
   firebase functions:secrets:set PURGE_SECRET
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```

## Required Firestore indexes

The purge query (`where archived == true AND where deletedAt < cutoff`) needs a composite index on each collection. Firebase will print a one-click link the first time the function runs; click it to create:

- `conversations`: `archived ASC`, `deletedAt ASC`
- `people`: `archived ASC`, `deletedAt ASC`

## Local testing

```bash
npm run build
firebase emulators:start --only functions,firestore
firebase functions:shell
> purgeArchivedHttp.post('/').body({ secret: 'test' })
```

## Notes

- Requires the **Blaze (pay-as-you-go)** plan because it uses Cloud Scheduler.
- Cost is negligible for typical usage (one tiny job per day).
- The client UI (`Archive` page, inline restore) is unchanged — this only enforces the 30-day cap on the server side.
