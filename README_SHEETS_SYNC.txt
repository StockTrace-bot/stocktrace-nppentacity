STOCKTRACE — GOOGLE SHEETS SYNC ADD-ON (untuk source integrated final yang sudah terpasang)

1. JANGAN meletakkan file JSON Service Account di folder Git atau mengirimkannya ke chat.
2. File tambahan/yang diperbarui pada zip ini:
   - api/sheets-sync.mjs (baru)
   - app.js (ditambah tombol sinkronisasi manual untuk Leader)
   - index.html (ditambah tombol dalam Rekap & Ekspor)
3. Salin isi zip ke ROOT repo StockTrace, timpa app.js dan index.html.
4. Vercel Environment Variables untuk project stocktrace-nppentacity (Production):
   GOOGLE_SHEETS_SPREADSHEET_ID (sudah dibuat)
   GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON (seluruh isi JSON SA sebagai nilai secret)
   STOCKTRACE_SHEETS_WEBHOOK_SECRET (acak minimal 32 byte / 64 hex; rahasia)
   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (sudah ada; jangan diubah).
5. Git add/commit/push, tunggu deploy Ready.
6. Login LEADER > Rekap & Ekspor > Sinkronkan Google Sheets -> akan menarik seluruh laporan lama.
7. Baru kemudian buat 3 Database Webhooks di Supabase Dashboard.
   URL: https://stocktrace-nppentacity.vercel.app/api/sheets-sync
   Method POST, Content-Type application/json. Tambah HTTP header
   x-stocktrace-sync-secret : isi persis secret Vercel (jangan bagikan).
   Webhook 1: public.cases, events INSERT, UPDATE, DELETE.
   Webhook 2: public.evidence_files, events INSERT, UPDATE, DELETE.
   Webhook 3: public.case_logs, events INSERT, UPDATE, DELETE.
8. Tes: Staff membuat laporan, upload bukti, Leader ubah status, pantau 3 tab.
9. Bila webhook telat/gagal, Leader boleh klik sinkronisasi manual.

CATATAN:
- Ini sinkronisasi mendekati real-time, bukan konsistensi transaksional persis.
- Webhook di Supabase menggunakan trigger asynchronous pg_net; request bisa gagal.
- Jangan edit baris hasil sinkronisasi di Sheets karena bukan database utama.
- Maksimal sinkronisasi ulang 5000 record per tabel (untuk prototipe).
- Client UI tidak mengandung JSON/private key, dan hanya Leader/Admin dapat full sync.
- Jangan memberikan akses spreadsheet ke publik.
- Jika private key bocor, segera revoke/rotate kunci di Google Cloud.
- Setelah membuat env var, redeploy diperlukan agar Vercel membacanya.
- Webhook menyimpan secret pada konfigurasi/trigger Supabase. Rahasiakan export SQL dan backups.
- Bila perlu stabilitas lebih tinggi: gunakan queue/retry dan reconciliation terjadwal.
