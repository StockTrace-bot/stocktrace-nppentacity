STOCKTRACE V2.1 — GOOGLE SHEETS SYNC (STAGING)

Endpoint: /api/sheets-sync
Authentication: HTTP header x-stocktrace-sync-secret, matched against STOCKTRACE_SHEETS_WEBHOOK_SECRET in the Vercel Preview environment.

MAPPING
- R1: cases, evidence_files, case_logs -> GOOGLE_SHEETS_SPREADSHEET_ID
  Tabs: Kasus, Bukti, Riwayat.
- V2.1: stocktrace_intakes, stocktrace_intake_items, stocktrace_intake_evidence,
  stocktrace_cashier_requests, stocktrace_cashier_logs -> GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID
  Tabs: Penerimaan, Detail SKU, Bukti Penerimaan, Permintaan Kasir, Riwayat Permintaan Kasir.

WEBHOOKS
The staging database should have exactly eight Database Webhooks, one per mapped table, each with INSERT, UPDATE, DELETE enabled and POST to the staging Preview /api/sheets-sync endpoint. The current project audit showed 8/8 enabled. Do NOT create duplicates or edit them unless the read-only audit proves a mismatch.

VERCEL PREVIEW ENVIRONMENT VARIABLES
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
- GOOGLE_SHEETS_SPREADSHEET_ID
- GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID
- STOCKTRACE_SHEETS_WEBHOOK_SECRET

The Service Account must have Editor access to both staging spreadsheets. Never put its JSON, private key, webhook secret, or OAuth credentials in GitHub or browser code.

FULL SYNC
- Leader mode { mode: "full" } refreshes only the three R1 tabs.
- Leader mode { mode: "full_penerimaan" } refreshes only the five V2.1 tabs.
- Full sync is a snapshot reconciliation, not a substitute for live webhook delivery.

LIMITATIONS
Supabase pg_net webhooks are asynchronous. HTTP failures need to be inspected in Vercel Logs and reconciled. Google Sheets and Supabase are not a distributed transaction. Keep the Supabase database as the source of truth; do not manually edit generated rows in Sheets.
