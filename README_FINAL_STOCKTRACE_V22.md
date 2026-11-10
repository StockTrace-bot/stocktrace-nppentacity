# StockTrace V2.2 — FINAL SOURCE PACKAGE

Paket ini adalah source lengkap dari ZIP repository yang diberikan, dengan revisi keamanan sesi, pengarsipan yang dapat dipulihkan, sinkronisasi status arsip ke Google Sheets/Drive, dan penyempurnaan responsif.

## Perubahan V2.2

### 1. Arsip & Sampah (Soft Delete)
- Tidak ada tombol hapus permanen di aplikasi.
- Laporan kasus, bukti kasus, dokumen penerimaan, bukti penerimaan, dan permintaan kasir dapat diarsipkan sesuai hak akses.
- Semua tindakan meminta alasan minimal 8 karakter.
- Leader dapat memulihkan data dari menu **Arsip & Sampah**.
- Pengarsipan laporan ikut mengarsipkan bukti terkait dalam satu batch; pemulihan laporan mengembalikan bukti dari batch yang sama.
- Dokumen penerimaan ikut mengarsipkan rincian SKU dan bukti penerimaannya.
- Log audit tetap dipertahankan; pengarsipan tidak menghapus catatan riwayat.
- Staff hanya boleh mengarsipkan laporan miliknya yang masih **Baru Dilaporkan** dan belum memiliki PIC, bukti miliknya pada kondisi yang sama, serta permintaan kasir miliknya yang masih **Diajukan**.
- Hanya Leader yang dapat mengarsipkan dokumen/bukti penerimaan dan memulihkan data.
- Data tidak dihapus dari database. File Drive tetap ada dan ditandai melalui `appProperties.stocktrace_status` (`archived` / `active`) agar dapat dipulihkan. File tidak dipindahkan permanen atau dihapus.

### 2. Sinkronisasi Google Sheets
- Kolom `Status Data` ditambahkan di akhir tab data yang dapat diarsipkan.
- Nilai status: `AKTIF` atau `DIARSIPKAN`.
- Header lama akan ditambah kolom baru secara append-only; kolom lama dan urutannya tidak diganti.
- Full Sync tetap mencakup data aktif dan arsip untuk akun Leader.
- Trigger INSERT/UPDATE yang sudah terpasang tetap digunakan. Tidak perlu mengganti secret, spreadsheet ID, atau membuat ulang delapan webhook Sheets.

### 3. Google Drive
- Dua trigger UPDATE tambahan mengirim perubahan status arsip bukti ke `/api/drive-delete`.
- File tetap tersimpan di folder yang sama, tidak dihapus permanen dan tidak dipindahkan ke Trash saat soft delete.
- Pemulihan menandai file kembali `active`.
- Event DELETE fisik yang dilakukan di luar alur aplikasi masih mengikuti endpoint lama dan memindahkan file terverifikasi ke Trash. Jangan menghapus record langsung dari SQL/Table Editor untuk operasional harian.

### 4. Login per tab
- Supabase Auth menggunakan `sessionStorage`, bukan `localStorage`.
- Refresh dan navigasi halaman dalam tab yang sama tetap mempertahankan sesi.
- Tab baru tidak berbagi sesi tab lama; setelah tab ditutup dan dibuka kembali, pengguna harus login lagi.
- Key sesi lama di `localStorage` dibersihkan saat aplikasi/login dibuka.
- Catatan: pemulihan tab oleh fitur browser tertentu dapat memulihkan sesi tab; uji perilaku pada browser perangkat operasional.

### 5. Responsif lintas perangkat
- Identitas desain navy/blue, Inter, sidebar kiri, komponen, dan alur navigasi dipertahankan.
- Desktop memakai sidebar tetap; tablet dan HP memakai drawer kiri.
- Tabel tetap dapat digeser secara horizontal; form, tombol arsip/pulihkan, detail, dan jarak sentuh disesuaikan untuk layar kecil.
- Ini adalah layout responsif dengan identitas visual konsisten, bukan memaksa ukuran desktop yang sama persis pada layar HP.

## Urutan deployment Production

**Jangan jalankan SQL 12 sebelum source code V2.2 sudah aktif di Production.** Endpoint `/api/drive-delete` perlu menerima event UPDATE terlebih dahulu.

1. Backup database Supabase dan pastikan backup bisa diakses. Jangan melakukan reset data.
2. Ekstrak ZIP ini dan salin isi folder proyek ke repository lokal yang sudah memiliki `.git`. Jangan menimpa folder `.git`.
3. Jalankan pemeriksaan lokal:

   ```bash
   node --check app.js
   node --check v21.js
   node --check api/sheets-sync.mjs
   node --check api/drive-delete.mjs
   npm test
   ```

   Paket QA ini lulus 60/60 tes simulasi pada saat dibuat. Tes simulasi tidak menggantikan tes langsung terhadap database, akun OAuth, Drive, dan spreadsheet Production.

4. Commit dan push ke branch `main`, lalu tunggu deployment Vercel **Production** berstatus Ready.
5. Pastikan domain Production tetap `https://stocktrace-nppentacity.vercel.app` dan environment variables lama tetap tersedia. Tidak ada environment variable baru yang diperlukan. Jangan mengganti `STOCKTRACE_SHEETS_WEBHOOK_SECRET` atau menggunakan Vercel Protection Bypass sebagai webhook secret.
6. Setelah deployment Ready, buka Supabase project Production → SQL Editor, lalu jalankan **sekali**:

   `sql/12_SOFT_DELETE_ARCHIVE_FINAL.sql`

   Script ini memerlukan trigger Sheets Production bernama `stocktrace_sync_bukti` yang mengarah ke `https://stocktrace-nppentacity.vercel.app/api/sheets-sync`. Jika nama/URL berbeda, script berhenti dan rollback; jangan menghapus trigger. Audit konfigurasi dahulu.
7. Baca hasil verifikasi paling bawah. Harus ada dua baris trigger Drive:
   - `evidence_files` → `stocktrace_soft_archive_drive_evidence` → `ENABLED` → `endpoint_is_drive_delete = true`
   - `stocktrace_intake_evidence` → `stocktrace_soft_archive_drive_intake_evidence` → `ENABLED` → `endpoint_is_drive_delete = true`
8. Login sebagai Leader, buka **Rekap & Ekspor**, jalankan **Sinkronkan Semua Google Sheets** satu kali agar kolom `Status Data` ditambahkan ke header spreadsheet lama.
9. Lakukan tes hanya pada data uji yang disetujui:
   - Staff buat laporan uji baru → Staff arsipkan laporan miliknya yang masih Baru Dilaporkan dan belum memiliki PIC.
   - Leader buka Arsip & Sampah → pulihkan laporan.
   - Leader arsipkan satu bukti uji → pastikan baris Sheets berstatus `DIARSIPKAN` dan file Drive `appProperties.stocktrace_status` menjadi `archived`.
   - Leader pulihkan bukti → status Sheets `AKTIF` dan Drive `active`.
   - Leader arsipkan dokumen penerimaan uji → rincian SKU dan bukti ikut diarsipkan; pulihkan dokumen dan pastikan seluruh batch kembali aktif.
   - Staff buat permintaan kasir uji berstatus `Diajukan`, arsipkan permintaannya, lalu Leader pulihkan.
   - Uji tab ditutup lalu buka URL aplikasi kembali: pengguna diminta login lagi. Refresh pada tab yang sama seharusnya tidak mengeluarkan pengguna.

## Catatan database dan integrasi

- SQL 12 bersifat tambahan dan tidak menjalankan `DELETE`, `TRUNCATE`, atau `DROP TABLE`.
- SQL 12 tidak memberi hak DELETE langsung ke Staff/Leader.
- SQL 12 mengganti policy SELECT agar pengguna biasa melihat data aktif; Leader dapat melihat data aktif dan arsip.
- Jangan menjalankan ulang SQL historis 01/02/03/05/08/09/10 jika sudah aktif.
- Jangan menjalankan `sql/11_DRIVE_DELETE_WEBHOOKS_STAGING.sql` di Production. File tersebut khusus alur staging lama.
- Jangan mengubah delapan webhook Sheets yang sudah berhasil HTTP 200.
- Webhook Supabase `pg_net` berjalan asynchronous. HTTP 200 dari endpoint menunjukkan request berhasil diproses, tetapi tetap periksa hasil Sheets dan status Drive.
- Jika status Drive gagal berubah, jangan menghapus metadata. Periksa Supabase `net._http_response` dan Vercel Logs; data tetap ada di database sehingga dapat direkonsiliasi.
- `Status Data` di Google Sheets adalah salinan monitoring. Supabase tetap menjadi sumber data utama.
- Tidak ada service-role key, OAuth secret, refresh token, atau JSON service account yang ditambahkan ke ZIP.

## Rollback aplikasi

Jika ada masalah setelah deployment, kembalikan deployment Vercel ke versi sebelumnya dan jangan jalankan operasi arsip baru sampai diperiksa. SQL 12 bersifat additive; jangan mencoba rollback dengan DROP COLUMN atau DROP TABLE karena data arsip/audit harus dipertahankan. Perbaikan dilakukan dengan migration forward.
