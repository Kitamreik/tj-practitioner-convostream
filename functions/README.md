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

### `requestWebmasterEscalation` (callable)
Any signed-in user can request escalation to webmaster. The request is persisted under `escalationRequests/` and emailed to **kit.tjclasses@gmail.com** when SMTP is configured. Without SMTP the request is still recorded so a webmaster can approve from the Settings page.

To enable email delivery, set the following Firebase function secrets (Gmail SMTP shown):

```bash
firebase functions:secrets:set SMTP_HOST   # e.g. smtp.gmail.com
firebase functions:secrets:set SMTP_PORT   # e.g. 587
firebase functions:secrets:set SMTP_USER   # sender Gmail address
firebase functions:secrets:set SMTP_PASS   # Gmail app password (not account password)
firebase functions:secrets:set SMTP_FROM   # optional, defaults to SMTP_USER
```

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
