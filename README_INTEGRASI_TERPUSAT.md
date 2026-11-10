# StockTrace V2.1 — Integrasi Terpusat untuk Production

Paket ini memakai satu peta tujuan integrasi untuk semua endpoint. Tujuan R1 dan V2.1 tetap dipisahkan sesuai rancangan:

- R1: tabel `cases`, `evidence_files`, `case_logs` → satu spreadsheet R1 dan satu folder Drive bukti kasus.
- V2.1: tabel penerimaan/kasir → satu spreadsheet penerimaan dan satu folder Drive bukti penerimaan.
- Supabase tetap menjadi sumber data utama.
- Google Sheets adalah salinan monitoring; Google Drive menyimpan file bukti.

## 1. Satu konfigurasi tujuan

Tambahkan SATU Environment Variable baru pada Vercel Project `stocktrace-nppentacity`:

- Key: `STOCKTRACE_INTEGRATION_TARGETS_JSON`
- Environment: **Production**
- Value: isi satu baris JSON berikut dengan empat ID tujuan Production yang benar.

```json
{"drive":{"r1FolderId":"ID_FOLDER_BUKTI_KASUS","intakeFolderId":"ID_FOLDER_BUKTI_PENERIMAAN"},"sheets":{"r1SpreadsheetId":"ID_SPREADSHEET_R1","intakeSpreadsheetId":"ID_SPREADSHEET_PENERIMAAN"}}
```

Ambil ID dari URL Google:

- Spreadsheet: bagian di antara `/spreadsheets/d/` dan `/edit`.
- Folder Drive: bagian setelah `/drive/folders/`.

Jangan tempel URL lengkap. Jangan memasukkan kredensial, refresh token, service-role key, atau private key ke JSON ini.

**Jangan menebak ID.** Pastikan empat ID itu memang resource Production yang ingin dipakai. Folder R1 dan folder penerimaan harus berbeda. Spreadsheet R1 dan spreadsheet penerimaan juga harus berbeda.

## 2. Kredensial yang tetap disimpan di Vercel

Jangan hapus atau memindahkan nilai rahasia yang sudah ada. Endpoint masih membaca kredensial server-side berikut dari Vercel:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`
- `STOCKTRACE_SHEETS_WEBHOOK_SECRET`

`STOCKTRACE_INTEGRATION_TARGETS_JSON` hanya menggantikan empat ID tujuan berikut secara terpusat:

- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_DRIVE_INTAKE_FOLDER_ID`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID`

Jika JSON pusat sudah terpasang, nilainya menjadi prioritas. Empat variabel lama tetap menjadi fallback bila JSON pusat belum dibuat. Jangan menghapus variabel lama dulu sampai tes Production selesai.

## 3. Setelah menambahkan variabel

1. Simpan Environment Variable `STOCKTRACE_INTEGRATION_TARGETS_JSON` pada **Production**.
2. Redeploy Production satu kali dari branch `main`.
3. Buka `https://stocktrace-nppentacity.vercel.app/api/integration-health`.
4. Pastikan `ok: true`, `environment: "production"`, `targetConfigSource: "STOCKTRACE_INTEGRATION_TARGETS_JSON"`, dan semua nilai di `checks` bernilai `true`.
5. Fingerprint hanya penanda pembanding, bukan ID asli. Endpoint tidak mengembalikan kredensial atau ID mentah.
6. Login sebagai Leader, pilih **Sinkronkan Semua Google Sheets**. Satu klik menjalankan full sync R1 dan V2.1 secara berurutan.
7. Buat satu bukti uji yang tidak sensitif pada kasus uji, lalu pastikan file masuk ke folder Drive R1. Uji penerimaan terpisah untuk memastikan folder penerimaan yang digunakan.

## 4. Webhook tidak perlu dibuat satu per satu lagi

Semua webhook tabel Google Sheets memakai endpoint yang sama, `/api/sheets-sync`. Endpoint menentukan spreadsheet tujuan dari nama tabel. Trigger UPDATE/DELETE bukti memakai `/api/drive-delete`, yang menentukan folder dari tabel bukti. Saat arsip pertama kali dipakai, endpoint membuat subfolder `ARSIP STOCKTRACE` secara otomatis; pemulihan memindahkan file kembali ke folder induk aktif. Tidak ada ID folder arsip tambahan atau environment variable baru.

Jangan membuat webhook duplikat. Jangan jalankan ulang SQL migrasi/reset. Jika webhook Production saat ini sudah ENABLED dan mengarah ke domain utama, biarkan tetap seperti itu.

## 5. Endpoint diagnostik

`GET /api/integration-health` hanya menampilkan status konfigurasi, environment, Supabase project ref, dan fingerprint tujuan. Endpoint ini tidak menampilkan secret, private key, refresh token, service-role key, maupun ID tujuan mentah.

## 6. Keamanan dan batasan

- Tidak ada data Supabase atau file Drive yang dihapus permanen oleh pengarsipan. File hanya dipindahkan antara folder aktif dan subfolder arsip; event DELETE fisik terverifikasi tetap menggunakan Trash.
- Tidak ada SQL reset atau migrasi database baru dalam paket integrasi terpusat.
- Tidak ada kredensial rahasia yang dimasukkan ke source code atau ZIP.
- Sinkronisasi Sheets tetap asynchronous melalui Supabase Database Webhooks; Supabase tetap sumber data utama.
- Jika `ok` bernilai `false`, jangan lanjut uji upload/hapus sampai variabel yang ditandai `false` diperbaiki.
