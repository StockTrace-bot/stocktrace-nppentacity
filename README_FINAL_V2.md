# Versi dasar V2 (tanpa modul tambahan)

**Jika menggunakan ZIP V2.1, baca `README_V2_1_MULAI_DI_SINI.md` terlebih dahulu.** Dokumen ini menjelaskan fitur dasar V2, bukan daftar fitur V2.1.

# StockTrace V2 — paket sumber terpadu, siap untuk staging

**Rilis kode terpadu, BUKAN bukti bahwa produksi sudah aman atau data sudah dihapus.** Dibangun dari ZIP GitHub `main` pengguna tanggal 29 Oktober 2026, dan mempertahankan desain sidebar navy kiri + dashboard profesional sesuai screenshot pengguna. Paket ini adalah SATU SOURCE lengkap, **jangan menggabungkannya dengan ZIP lama**.

## Cakupan source
- Login ID `NP-LDR-001` dan `NP-STF-001..004`; endpoint `/api/id-login` memetakan ID -> email Auth hanya di server. Email karyawan tidak tampil di UI.
- Pengaturan Akun Saya; verifikasi password lama dan update password melalui `/api/account-password`, pembatas percobaan, serta kewajiban mengganti password sementara setelah reset administrator.
- Alat reset password administrator lokal (`scripts/admin_reset_password.py`) default dry-run. **Tidak ada public-admin reset endpoint.**
- Alat migrasi email Auth lama ke alias internal unik dengan mempertahankan UUID (`scripts/migrate_auth_email.py`) **opsional dan memerlukan domain alias privat terkontrol**. Supabase Auth tetap menyimpan alamat email internal; sistem tidak bisa menjamin 100% email-less dengan Supabase password provider.
- Direct Drive resumable max 100 MiB + server-side verification, progress dan download streaming. CORS browser asli belum teruji.
- Dashboard navy yang sama seperti screenshot, sidebar kiri permanen HP & laptop; daftar kasus berupa tabel dengan scroll horizontal pada HP, bukan cards.
- SQL 08 dan 09 adalah tambahan untuk staging: status keamanan, restrictive RLS, rate limit password, penjagaan dua RPC SECURITY DEFINER.
- Pembersihan laporan, metadata dan file Drive memerlukan langkah TERPISAH, ada tool dry-run dan persetujuan manual. Semua file lama dipertahankan hingga diputuskan.
- `/api/public-config` memberi konfigurasi publik dari environment Vercel. Jika Vercel **Preview** masih memakai URL Supabase produksi lama, aplikasi sengaja **menolak berjalan** untuk mencegah penulisan data uji ke produksi.

## Buka dokumen berikut secara berurutan
1. `README_DEPLOY_STAGING.md`: langkah setup branch, DB dan Preview Vercel.
2. `README_UJI_TERIMA.md`: checklist sebelum merge ke main.
3. `README_RESET_DATA.md`: prosedur penghapusan laporan, Google Sheets, dan bukti Drive.

**Jangan** upload file kredensial `.env`, token, refresh token, file JSON service account, atau kata sandi ke GitHub/percakapan. Jangan jalankan SQL lama 01/02/03 ulang jika sebelumnya sudah aktif.

## Pemeriksaan otomatis yang dapat diulang
```
node --check app.js
node --check api/id-login.mjs
node --check api/account-password.mjs
node --check api/drive-upload.mjs
node --test tests/*.test.mjs
python -m py_compile scripts/*.py
```
Hasil tes simulasi tidak menggantikan integrasi Google Drive/OAuth/Supabase asli di perangkat HP.
