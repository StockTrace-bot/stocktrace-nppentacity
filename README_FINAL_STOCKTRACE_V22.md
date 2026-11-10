# StockTrace V2.2.1 — FINAL SOURCE PACKAGE

Paket ini adalah source lengkap dari ZIP repository yang diberikan, dengan revisi keamanan sesi, pengarsipan yang dapat dipulihkan, pemindahan file bukti ke folder arsip khusus Google Drive, sinkronisasi status arsip ke Google Sheets/Drive, dan penyempurnaan responsif.

## Perubahan V2.2.1 (patch Drive)

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
- Data tidak dihapus dari database. Saat bukti diarsipkan, file Drive dipindahkan dari folder bukti aktif ke subfolder `ARSIP STOCKTRACE` di dalam folder induk yang sama. File tetap tersimpan dan dapat dipulihkan ke folder aktif semula.

### 2. Sinkronisasi Google Sheets
- Kolom `Status Data` ditambahkan di akhir tab data yang dapat diarsipkan.
- Nilai status: `AKTIF` atau `DIARSIPKAN`.
- Header lama akan ditambah kolom baru secara append-only; kolom lama dan urutannya tidak diganti.
- Full Sync tetap mencakup data aktif dan arsip untuk akun Leader.
- Trigger INSERT/UPDATE yang sudah terpasang tetap digunakan. Tidak perlu mengganti secret, spreadsheet ID, atau membuat ulang delapan webhook Sheets.

### 3. Google Drive
- Dua trigger UPDATE mengirim perubahan status arsip bukti ke `/api/drive-delete`. Endpoint membuat subfolder `ARSIP STOCKTRACE` secara otomatis pada pemakaian pertama untuk folder bukti kasus dan folder bukti penerimaan; kedua jenis bukti tetap terpisah.
- File tidak dihapus permanen dan tidak dipindahkan ke Trash saat soft delete. File dipindahkan ke subfolder `ARSIP STOCKTRACE`, lalu dikembalikan ke folder aktif semula saat dipulihkan.
- Subfolder dibuat otomatis oleh endpoint Drive menggunakan OAuth yang sudah dipakai aplikasi; tidak ada environment variable atau ID folder arsip baru yang perlu ditambahkan.
- Event DELETE fisik yang dilakukan di luar alur aplikasi masih memindahkan file terverifikasi ke Trash. Jangan menghapus record langsung dari SQL/Table Editor untuk operasional harian.

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

## Urutan update Production untuk V2.2.1

**Database Production pengguna sudah menjalankan SQL 12. Jangan jalankan SQL 12 lagi.** Patch ini memakai SQL 13 untuk memperbarui webhook dan memindahkan file bukti lama yang sudah berstatus arsip.

1. Pastikan backup database tersedia. Jangan melakukan reset data.
2. Ekstrak ZIP V2.2.1. Salin isi folder proyek ke repository lokal `stocktrace-v22-review` yang sudah memiliki `.git`; jangan menimpa atau menghapus folder `.git`.
3. Jalankan pemeriksaan lokal:

   ```bash
   node --check app.js
   node --check v21.js
   node --check api/drive-delete.mjs
   node --test tests/*.test.mjs
   ```

4. Commit dan push source ke branch review, lalu gabungkan ke `main` setelah pemeriksaan selesai. Tunggu deployment Vercel **Production** berstatus Ready.
5. Pastikan environment variables Production yang lama tetap tersedia, terutama `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `STOCKTRACE_SHEETS_WEBHOOK_SECRET`, dan target folder Drive. Tidak ada environment variable baru yang diperlukan.
6. Setelah source V2.2.1 aktif di Production, buka Supabase project Production → SQL Editor dan jalankan **sekali** `sql/13_DRIVE_ARCHIVE_FOLDER_MIGRATION.sql`. Script ini mengambil URL, header, dan secret dari trigger Drive Production yang sudah aktif; tidak perlu menyalin atau menampilkan secret.
7. SQL 13 memperbarui dua trigger Drive dan mengirim rekonsiliasi untuk bukti yang sudah diarsipkan sebelum patch ini. Webhook berjalan asynchronous. Periksa `net._http_response` dan Vercel Logs setelah migrasi.
8. Folder `ARSIP STOCKTRACE` dibuat otomatis saat bukti pertama kali diarsipkan di masing-masing folder induk. Tidak perlu membuat folder manual. Jika folder dengan nama itu sudah ada tetapi bukan folder yang dibuat StockTrace, endpoint menolak memakainya agar file tidak tercampur; ubah nama folder manual tersebut lalu coba lagi.
9. Uji dengan satu bukti percobaan yang tidak sensitif:
   - Arsipkan bukti kasus R1 → file harus hilang dari daftar file langsung di folder aktif dan muncul di `ARSIP STOCKTRACE`.
   - Pulihkan bukti → file harus kembali ke folder aktif semula.
   - Ulangi pada bukti penerimaan untuk memastikan folder arsip penerimaan terpisah.
10. Uji satu laporan dan satu dokumen penerimaan melalui menu **Arsip & Sampah**. Pastikan status database dan Google Sheets tetap sinkron. Jangan gunakan bukti operasional penting untuk pengujian pertama.

Tes otomatis hanya menguji perilaku simulasi API; tes tersebut tidak menggantikan pengujian langsung terhadap OAuth Google, Drive, Supabase, dan webhook Production.

## Catatan database dan integrasi

- SQL 12 bersifat tambahan dan tidak menjalankan `DELETE`, `TRUNCATE`, atau `DROP TABLE`.
- SQL 12 tidak memberi hak DELETE langsung ke Staff/Leader.
- SQL 12 mengganti policy SELECT agar pengguna biasa melihat data aktif; Leader dapat melihat data aktif dan arsip.
- Jangan menjalankan ulang SQL historis 01/02/03/05/08/09/10 jika sudah aktif.
- Jangan menjalankan `sql/11_DRIVE_DELETE_WEBHOOKS_STAGING.sql` di Production. File tersebut khusus alur staging lama.
- Jangan mengubah delapan webhook Sheets yang sudah berhasil HTTP 200.
- Webhook Supabase `pg_net` berjalan asynchronous. HTTP 200 dari endpoint menunjukkan request berhasil diproses, tetapi tetap periksa hasil Sheets dan status Drive.
- Jika status Drive gagal berubah atau folder arsip tidak terbentuk, jangan menghapus metadata. Periksa Supabase `net._http_response` dan Vercel Logs. Pastikan OAuth Google memiliki izin Drive untuk membuat folder dan memindahkan file; data tetap ada di database sehingga dapat direkonsiliasi.
- `Status Data` di Google Sheets adalah salinan monitoring. Supabase tetap menjadi sumber data utama.
- Tidak ada service-role key, OAuth secret, refresh token, atau JSON service account yang ditambahkan ke ZIP.

## Rollback aplikasi

Jika ada masalah setelah deployment, hentikan operasi arsip baru sampai diperiksa dan kembalikan deployment Vercel bila perlu. Jangan menghapus folder arsip atau menghapus metadata `stocktrace_archive_folder` / `stocktrace_original_parent` secara manual. SQL 12 dan SQL 13 tidak boleh di-rollback dengan DROP COLUMN atau DROP TABLE; perbaikan dilakukan dengan migration forward.
