# ConvoHub Cloud Functions

Server-side retention enforcement for the ConvoHub Firestore database.

## What it does

`scheduledArchivePurge` runs daily at **03:00 UTC** and permanently deletes:

- `conversations` documents where `archived == true` and `deletedAt` is older than **30 days** — including all messages in the `messages/` subcollection.
- `people` documents matching the same criteria.

Each run writes a summary entry to `retentionAudit/` with the run time, cutoff, and counts.

A second function, `purgeArchivedHttp`, lets an admin trigger the same purge on demand:

```bash
curl -X POST https://<region>-<project>.cloudfunctions.net/purgeArchivedHttp \
  -H "Content-Type: application/json" \
  -d '{"secret":"<PURGE_SECRET>"}'
```

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
