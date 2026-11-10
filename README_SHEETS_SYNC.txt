STOCKTRACE V2.1 — GOOGLE SHEETS SYNC

Endpoint: /api/sheets-sync
Authentication: HTTP header x-stocktrace-sync-secret, matched against STOCKTRACE_SHEETS_WEBHOOK_SECRET in Vercel.

MAPPING
- R1: cases, evidence_files, case_logs -> target sheets.r1SpreadsheetId.
  Tabs: Kasus, Bukti, Riwayat.
- V2.1: stocktrace_intakes, stocktrace_intake_items, stocktrace_intake_evidence,
  stocktrace_cashier_requests, stocktrace_cashier_logs -> target sheets.intakeSpreadsheetId.
  Tabs: Penerimaan, Detail SKU, Bukti Penerimaan, Permintaan Kasir, Riwayat Permintaan Kasir.

CENTRAL TARGET CONFIG
Prefer the single Vercel variable STOCKTRACE_INTEGRATION_TARGETS_JSON. It contains both spreadsheet IDs
and both Drive folder IDs. See README_INTEGRASI_TERPUSAT.md. Legacy GOOGLE_SHEETS_SPREADSHEET_ID and
GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID are fallback-only when the JSON map is absent.

WEBHOOKS
All eight table webhooks use the same Production /api/sheets-sync endpoint and the same webhook secret.
The endpoint selects the correct spreadsheet from the table name. Do not create duplicate webhooks.
Keep existing enabled Production webhooks if their URL and secret are correct.

FULL SYNC
- Leader mode { mode: "full" } refreshes only the three R1 tabs.
- Leader mode { mode: "full_penerimaan" } refreshes only the five V2.1 tabs.
- The UI button "Sinkronkan Semua Google Sheets" runs both modes sequentially in one click.
- Full sync is a snapshot reconciliation, not a substitute for live webhook delivery.

LIMITATIONS
Supabase pg_net webhooks are asynchronous. HTTP failures need to be inspected in Vercel Logs and reconciled.
Google Sheets and Supabase are not a distributed transaction. Keep Supabase as the source of truth; do not
manually edit generated rows in Sheets.
