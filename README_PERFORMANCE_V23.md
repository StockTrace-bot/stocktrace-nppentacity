# StockTrace V2.3 — Performance Optimization

## What changed

### Login and first dashboard load
- Third-party UI scripts use `defer` so they do not block HTML parsing.
- CDN origins are preconnected.
- `/api/public-config` briefly caches only the Supabase URL and public publishable key.
- Profile lookup and account-security check run concurrently after the authenticated session is confirmed.
- Staff directory and dashboard cases load concurrently.
- Dashboard requests select the fields the UI uses and reuse a fresh result for 12 seconds to avoid repeat loads during navigation.

### Intake and cashier pages
- Tables request only the columns used by the page.
- Archived rows are filtered by `deleted_at IS NULL` at the database query.
- Page size is increased from 500 to 1,000 rows (up to 5,000 loaded, as before).
- Recent results are reused for 15 seconds when revisiting the same view; explicit refresh and successful changes force a fresh read.

### Evidence upload
- Two files upload concurrently, instead of one at a time.
- Metadata for each two-file batch is inserted together. If the batch insert fails, the app retries metadata one file at a time so one bad row does not block the other.
- File bytes still go directly from the browser to Google Drive using resumable upload; they do not pass through a Vercel function.
- Original files are not resized or recompressed. This preserves the submitted evidence and its metadata.

### Google Drive and login APIs
- Google OAuth access tokens are cached in warm Vercel instances until shortly before expiry.
- Drive folder permission checks are cached briefly and run only when starting an upload; the verify step still validates file owner, case/intake, folder, filename, and exact size.
- Supabase role and record checks in the upload endpoint run in parallel after the user is authenticated.
- The ID login rate gate and internal login-ID lookup run concurrently; credentials are still exchanged only after the rate gate allows the attempt.

## Safety and compatibility

- No SQL migration is included or required.
- No changes to database tables, RLS, roles, archive/restore behavior, official POS data, OAuth credentials, or Vercel environment variables.
- Supabase remains the source of truth.
- Uploads remain verified against the correct Drive folder, record, uploader, filename, and exact byte size.
- The app still requires a successful metadata write before reporting an evidence file as saved.

## Automated checks

Run from the project root:

```powershell
node --check app.js
node --check v21.js
node --check api/drive-upload.mjs
node --check api/id-login.mjs
node --check api/public-config.mjs
npm.cmd test
```

Expected test result: **84 passed, 0 failed**.

These tests validate application logic and mocked integrations. They do not measure real-world latency or replace a live test of Supabase, Google Drive, Google Sheets, Vercel, and mobile networks.

## Deployment

1. Keep the existing local Git clone; do not delete or overwrite its `.git` directory.
2. Extract this source ZIP into a separate folder.
3. Copy the extracted project files over the existing local Git clone, preserving `.git`, `.vercel`, and `node_modules` if present.
4. Run the syntax checks and `npm.cmd test` above.
5. Review `git status`, commit the source changes, and push to the branch connected to the intended Vercel deployment.
6. Wait for Vercel to finish deploying, then test login, dashboard, one small photo upload, multiple photos, one video/PDF upload, and Google Sheets synchronization.

Do not run SQL files from this ZIP for this performance update.
