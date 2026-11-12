# StockTrace V2.4.2 — Auth Boot Guard

## Masalah yang diperbaiki
Pada V2.4.1, `index.html` masih merender sidebar dan Dashboard secara default (`#view-dashboard` memakai `class="block"`). Pemeriksaan sesi baru dimulai setelah `app.js` berjalan, sehingga pengguna yang belum login sempat melihat shell aplikasi sebelum diarahkan ke `login.html`.

## Perubahan
- Shell aplikasi disembunyikan sejak first paint dengan `body.st-auth-pending`.
- Layar netral "Memeriksa sesi dan hak akses..." ditampilkan selama pemeriksaan.
- Shell hanya dibuka setelah Supabase session, profil pengguna, role, dan status keamanan akun berhasil diverifikasi.
- Jika tidak ada sesi, browser langsung diarahkan ke `login.html` tanpa menampilkan dashboard.
- Jika pemeriksaan profil/keamanan gagal, shell tetap terkunci dan layar aman menampilkan pesan serta tombol coba lagi.
- CSS sidebar kritis diperkuat agar warna navy/putih konsisten sebelum dan sesudah Tailwind CDN dimuat.

## Batas cakupan
- Tidak ada SQL migration.
- Tidak mengubah database, RLS, Supabase Webhooks, Google Drive, atau konfigurasi Vercel.
- Tidak mengubah `api/sheets-sync.mjs`; sinkronisasi otomatis Google Sheets tetap perlu diverifikasi dengan log webhook baru setelah header canonical sudah diperbaiki melalui Full Sync terakhir.
- Tidak perlu menjalankan SQL 15 lagi atau membuat webhook baru.

## Validasi
- `node --check app.js`
- `node --check api/sheets-sync.mjs`
- `npm test`: 99 passed / 0 failed pada source kerja yang digunakan untuk membuat patch.
- Tes tambahan memeriksa bahwa body terkunci sejak first paint dan hanya dibuka setelah pemeriksaan identitas serta keamanan.

Catatan: pengujian otomatis statis tidak menggantikan uji browser setelah deployment. Setelah Vercel Production berstatus Ready, uji URL Production pada jendela Incognito tanpa sesi dan pada tab yang sudah login.
