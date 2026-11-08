# StockTrace V2.1 — automatic Google Drive evidence cleanup (STAGING)

This add-on moves a verified evidence file to Google Drive Trash after its metadata row is deleted from Supabase. It never permanently deletes a Drive file.

## What is included
- `api/drive-delete.mjs`: authenticated Supabase Database Webhook endpoint.
- `sql/11_DRIVE_DELETE_WEBHOOKS_STAGING.sql`: adds two `AFTER DELETE` triggers for `public.evidence_files` and `public.stocktrace_intake_evidence`.
- The SQL installer copies the Preview endpoint URL, HTTP method, headers, and timeout from the existing `stocktrace_v21_staging_cases_sync` webhook. The webhook secret is copied inside PostgreSQL and is never printed.
- Existing eight Google Sheets triggers are not modified.

## Required Vercel Preview environment variables
- `STOCKTRACE_SHEETS_WEBHOOK_SECRET` (same value already used by `/api/sheets-sync`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_DRIVE_INTAKE_FOLDER_ID`

Use only the dedicated staging folders and OAuth account. Do not add credentials to Git or send them in chat. The Google OAuth refresh token must have permission to move the app's uploaded evidence files to Trash.

## Install (after deploying the Preview code)
1. Confirm the Vercel Preview deployment for branch `v2-1-staging` is Ready and `/api/drive-delete` is deployed.
2. Confirm the Preview environment variables above are present and scoped to the staging deployment.
3. In the Supabase project named for staging, run `sql/11_DRIVE_DELETE_WEBHOOKS_STAGING.sql` once in SQL Editor.
4. The script fails closed unless it finds the existing `cases` webhook, sees the expected staging Preview URL, and verifies all eight Sheets webhooks share the same URL and headers.
5. Confirm the final query returns exactly two ENABLED triggers pointing to `/api/drive-delete`.

## Behavior and limits
- Only DELETE events for `evidence_files` and `stocktrace_intake_evidence` are accepted.
- The endpoint verifies the record ID, Drive file ID, expected folder, filename prefix, StockTrace description, and any available appProperties before moving the file to Trash.
- Already missing or already trashed files are treated as idempotent success.
- Files outside the expected staging folder are refused; they are not deleted.
- Supabase `pg_net` webhooks are asynchronous and are not a distributed transaction with Supabase/Google Drive. A 2xx endpoint response is the success signal; failed requests need log review/reconciliation. Do not claim strict atomic consistency.
- This add-on does not create a user-facing delete button or grant authenticated users direct DELETE privileges. It handles evidence DELETE events initiated by an authorized database operation/RPC.
- The intake schema currently uses `ON DELETE RESTRICT` for intake items/evidence and does not include an intake-delete RPC. Do not try to delete a parent intake record until a separate, audited cascade workflow is implemented.
- Do not test against production data. For the first live integration test, create one staging record and one staging evidence file only after this endpoint and triggers are deployed.
