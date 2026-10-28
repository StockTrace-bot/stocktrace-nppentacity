# STOCKTRACE — V1.0 PROTOTYPE | SATU PAKET FINAL

**Nama paket tunggal:** `STOCKTRACE_FINAL_SATU_PAKET_V1_0.zip`  
**Tanggal konsolidasi:** 28 Oktober 2026  
**Tujuan:** satu arsip penuh untuk menggantikan ZIP patch yang beredar sebelumnya.

## Isi yang dikonsolidasikan

Ini **full source** (bukan patch terpisah). `index.html`, `login.html`, dan `app.js` sudah berupa file lengkap terakhir; ketiga API juga lengkap.

- Desktop + navigasi Android/iPhone: `index.html`, `login.html` dan styling mobile.
- Hak akses Staff/Leader, layout Staff terpusat, dashboard, laporan, detail, arsip, ekspor: `app.js` dan `index.html`.
- Google Drive: `api/upload.mjs`, `api/evidence.mjs`.
- Google Sheets (webhook, sinkronisasi manual Leader, WITA): `api/sheets-sync.mjs`.
- Halaman publik, CSS dan dependensi: `about.html`, `privacy.html`, `terms.html`, `public.css`, `package.json`.
- `sql/`: arsip migrasi dan policy satu gerai sebagai **dokumentasi historis**, bukan skrip untuk dijalankan ulang.
- `.gitignore`: menghindari masuknya rahasia umum ke Git; jangan pernah commit JSON service account, backup data, token, atau private key.
- `ENV_VERCEL_NAMA_SAJA.txt`: hanya DAFTAR NAMA variabel Vercel, bukan nilainya.

## PENTING: pemasangan yang dimaksud adalah mengganti source code, BUKAN menghapus data

**JANGAN:** menghapus repository Git, tabel Supabase, bucket/berkas Google Drive, spreadsheet,
webhook Supabase, database backup, atau environment variables Vercel.

Data laporan, bukti, dan log sudah disimpan di luar ZIP (Supabase/Google Drive/Sheets). ZIP ini tidak menyimpan isi database.
Tidak perlu mengulang setup Google Cloud atau mengeksekusi file di folder `sql/`.

## Cara memasang ulang dari satu ZIP saja

1. Simpan paket ZIP master ini dan ekstrak menggunakan **Extract All**. Pastikan hasilnya punya folder
   `STOCKTRACE_FINAL_SATU_PAKET_V1_0` yang langsung berisi `index.html`, `login.html`, `app.js`, `api/`, dan `sql/`.
2. **Jangan** menghapus `C:\Users\hilmi\Downloads\stocktrace-app`; folder itu adalah repository Git yang terhubung ke Vercel.
3. Buka PowerShell dan jalankan kode berikut satu per satu:

   ```powershell
   cd C:\Users\hilmi\Downloads\stocktrace-app
   git status
   Copy-Item -Path 'C:\Users\hilmi\Downloads\STOCKTRACE_FINAL_SATU_PAKET_V1_0\*' -Destination '.\' -Recurse -Force
   Copy-Item -Path 'C:\Users\hilmi\Downloads\STOCKTRACE_FINAL_SATU_PAKET_V1_0\.gitignore' -Destination '.\.gitignore' -Force
   node --check app.js
   node --check api/upload.mjs
   node --check api/evidence.mjs
   node --check api/sheets-sync.mjs
   git status
   git diff --stat
   ```

4. Tinjau perubahan. Jangan lanjut bila melihat file `.env`, file JSON kredensial, backup SQL berisi data, atau private key sebagai file baru yang akan ditambahkan.
5. **Setelah yakin file aman**, commit dan push (jangan jalankan jika masih ada modifikasi tidak terkait):

   ```powershell
   git add index.html login.html app.js about.html privacy.html terms.html public.css package.json api sql .gitignore README_FINAL_MULAI_DI_SINI.md ENV_VERCEL_NAMA_SAJA.txt
   git commit -m "Consolidate StockTrace v1.0 full source and mobile support"
   git push origin main
   ```

   Perintah `git commit` bisa memberi `nothing to commit` bila isi repo sudah sama persis; itu **normal**.
   `README_FINAL_MULAI_DI_SINI.md` di repo akan berasal dari master ini jika berkasnya ikut disalin.
6. Buka Vercel > Deployments > pastikan deployment commit terbaru **Ready**.
7. Cek akun Staff dan Leader; lapor simulasi, upload/download bukti, perubahan status khusus Leader,
   ketiga tab Google Sheets otomatis, dan resync manual Leader. Tes langsung dengan Android Chrome dan iPhone Safari.

## Kapan boleh hapus ZIP lain?

**Setelah** paket tunggal ini tersimpan, source berhasil dipasang di GitHub, deployment Vercel Ready, dan uji fitur berhasil.
Saat itu boleh menghapus **ZIP patch/kode lama** di Downloads, contohnya:
`StockTrace_Integrated_Final_Sesuai_Supabase.zip`,
`StockTrace_Sheets_Sync_Update.zip`, `StockTrace_Fix_Jam_WITA.zip`,
`StockTrace_Fix_Layout_Staff.zip`, `StockTrace_Mobile_Android_iPhone_Update.zip`,
`StockTrace_MASTER_FINAL_Full_Web_Android_iPhone.zip`.

**JANGAN HAPUS** `StockTrace_Backup_Sebelum_Migrasi.zip`, database backup apa pun, file JSON Service Account rahasia, atau folder Git `stocktrace-app`. Kalau ingin menghapus `StockTrace_Source_Terkini.zip`, pastikan kamu sudah mempunyai cadangan source terpisah karena itu snapshot awal, bukan sekadar patch.

## Batasan yang masih berlaku

- Ini aplikasi web untuk browser (bukan APK atau IPA).
- Responsif mobile sudah diperiksa secara statis, tetapi pengujian real-device tetap dilakukan setelah deploy.
- Maksimum upload bukti kira-kira 4 MB per file sesuai batas server saat ini.
- Google Sheets bersifat sinkronisasi mendekati real-time, bukan transaksi atomik lintas sistem.
- Backup database sebelumnya belum dipulihkan dalam uji restore; prototipe belum melalui audit keamanan penuh.
- Policy baca semua kasus disiapkan untuk **satu gerai**; perlu pembatasan tambahan jika melayani banyak cabang.
- OAuth Google, Vercel, dan Supabase tetap memerlukan pemantauan operasional berkala.

## Ringkasan QA paket ini

Lihat `HASIL_AUDIT_PAKET.txt`: lint JavaScript, seluruh referensi ID `app.js`, kesesuaian file-versi akhir, ZIP integrity, dan pencarian kredensial. Ini pemeriksaan paket, **bukan** klaim bahwa seluruh operasi live telah diuji ulang setelah update mobile.
