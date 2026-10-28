# STOCKTRACE v1.2 — PAKET UTUH PIC & 5 AKUN

**Ini paket source code UTUH**, bukan patch. Dibangun dari StockTrace V1.1 yang sudah bekerja, termasuk mobile nav tidak menutup tombol, layout Staff, Google Drive, Google Sheets webhook & WITA.

## Perubahan v1.2
- 4 akun Staff individual + 1 akun Leader (dibuat melalui Supabase Auth, bukan dibuat otomatis dari ZIP).
- Pelapor ditentukan otomatis menggunakan `auth.uid()` (tidak ada dropdown "siapa yang melapor").
- Leader saja yang dapat menetapkan/mengganti/melepas PIC Staff pada detail kasus.
- Penugasan PIC membutuhkan catatan, menyimpan snapshot nama PIC, dan dicatat pada `case_logs` secara atomik.
- Staff tetap dapat membaca kasus bersama dan unggah bukti, tapi tidak dapat menugaskan PIC maupun mengubah keputusan/status.
- Kasus lama aman: PIC awalnya kosong sampai ditugaskan, tidak menghapus laporan/riwayat/bukti.
- Google Sheets tab **Kasus** menambah 3 kolom di akhir: ID PIC, Nama PIC, Ditugaskan Pada (WITA). Tab Bukti/Riwayat tetap.
- CSV dan detail kasus menampilkan pelapor serta PIC.

## PENTING SEBELUM MIGRASI
1. Simpan backup database Supabase kamu. Jangan kirim backup atau secret kepada siapa pun.
2. Pastikan proyek Supabase adalah StockTrace DB dengan skema v1.1. **Jangan jalankan ulang** SQL migrasi historis `01_...` dan `02_...`.
3. SQL BARU yang perlu dijalankan **sekali** ialah `sql/03_AKTIFKAN_PIC_V1_2_JALANKAN_SEKALI.sql` melalui Supabase SQL Editor sebagai admin. SQL memakai BEGIN/COMMIT, tidak menghapus tabel atau data lama. **Ini mengubah izin INSERT pada cases**, jadi pastikan tidak ada aplikasi lain yang menggunakan tabel ini.
4. Saat SQL sukses, baru deploy file sumber baru ke Vercel. Kalau deploy duluan, fitur PIC belum tersedia sampai SQL dijalankan.

## Cara memasang dari satu ZIP

1. Ekstrak seluruh isi ZIP menjadi folder `STOCKTRACE_FINAL_PIC_5_AKUN_V1_2` pada Downloads.
2. Simpan repo `C:\Users\hilmi\Downloads\stocktrace-app` (jangan hapus folder `.git`).
3. Pada PowerShell:

```powershell
cd C:\Users\hilmi\Downloads\stocktrace-app
Copy-Item -Path 'C:\Users\hilmi\Downloads\STOCKTRACE_FINAL_PIC_5_AKUN_V1_2\*' -Destination '.\' -Recurse -Force
node --check app.js
node --check api/upload.mjs
node --check api/evidence.mjs
node --check api/sheets-sync.mjs
git status
```

4. Tinjau perubahan. Perhatikan **jangan pernah commit** `.env`, JSON service account, token, file backup asli atau password.
5. Lalu:

```powershell
git add index.html login.html app.js about.html privacy.html terms.html public.css package.json api sql .gitignore README_FINAL_MULAI_DI_SINI.md ENV_VERCEL_NAMA_SAJA.txt
git commit -m "StockTrace v1.2 individual staff accounts and leader PIC assignment"
git push origin main
```

6. Vercel `Deployments` harus **Ready**. Jangan ganti variabel Vercel atau webhook Supabase yang sudah bekerja.
7. Login sebagai Leader → `Rekap & Ekspor` → **Sinkronkan Google Sheets** sekali setelah deploy. Ini memperbarui header `Kasus` beserta data lama. Selanjutnya event webhook INSERT/UPDATE menjaga sinkronisasi otomatis. Script juga mengenali dan menaikkan header versi lama secara otomatis pada webhook Kasus.

## Membuat 4 Staff individual + 1 Leader

Jangan berbagi password akun Staff. Jumlah akun bukan dibuat oleh migrasi SQL; butuh identitas login masing-masing orang.

- Supabase Dashboard → **Authentication → Users**. Lihat dulu akun Staff dan Leader yang sudah ada. Jika akun Staff lama benar-benar dipakai satu karyawan tertentu, akun itu boleh menjadi salah satu dari empat; sisanya dibuat secara individual.
- Buat akun melalui fitur **Invite user** (lebih baik agar setiap orang menetapkan password sendiri), atau buat login di Admin hanya jika invitation tidak tersedia. Pastikan redirect/URL login di Supabase Auth sudah benar.
- Setelah akun muncul di Authentication, masukkan profilnya ke `public.users` dengan `id_user` **persis sama** dengan UUID auth pengguna tersebut, `nama_lengkap` nama karyawan, `email` email yang sesuai, `role='Staff'` (Leader satu akun `role='Leader'`). Gunakan Table Editor dan periksa UUID satu per satu. Jangan membuat akun fiktif dengan nama generik di data asli.
- Akun lama yang dahulu dibagi bersama sebaiknya dipensiunkan setelah semua karyawan punya akun individual; jangan hapus histori laporan. Jangan aktifkan self-register tanpa pengendalian.
- Verifikasi dengan SQL read-only `sql/04_QA_AKUN_DAN_PIC_READONLY.sql`. Jumlah ideal: **4 profil Staff dan 1 Leader**; bila dulu ada akun bersama ekstra, audit sebelum menonaktifkannya.

## Pengujian yang WAJIB dilakukan

1. Staff A login → buat laporan simulasi → pelapor muncul sebagai Staff A otomatis.
2. Leader login → buka kasus → dropdown PIC menampilkan akun Staff A–D → pilih Staff B + alasan minimal 8 karakter → Simpan.
3. Staff A/B login → lihat laporan & PIC Staff B; bagian penugasan dan keputusan Leader tidak muncul.
4. Leader ganti Staff B ke Staff C → nama terbaru dan riwayat tercatat (log lama tidak berubah).
5. Google Sheets tab Kasus punya kolom ID PIC, Nama PIC, Ditugaskan Pada dan isi sesuai penugasan. Tab Riwayat mencatat aksi penugasan.
6. Uji upload/download Google Drive; validasi WITA; uji form pada Android Chrome/iPhone Safari.
7. Audit SQL: Staff tidak memiliki GRANT UPDATE/DELETE ke cases, fungsi assign_pic menolak user bukan Leader. Uji keamanan backend secara terkontrol; jangan jalankan kode asing di DevTools.

## Batas penting

- PIC **bukan** hak mengubah status. Koreksi inventory resmi tetap wewenang perusahaan/IT/MD; StockTrace hanya mencatat penelusuran dan keputusan tindak lanjut gerai.
- Google Sheets sinkron mendekati real-time, bukan sistem transaksi real-time absolut. Bila webhook gagal, Leader gunakan tombol Sinkronkan Google Sheets.
- Sistem dibangun untuk **satu gerai**. Penambahan cabang perlu kolom gerai & pembatasan RLS baru.
- Bukti maksimum 4 MB per file. Data dan backup tetap di Supabase/Google Drive, bukan di ZIP.
- Waktu WITA ditampilkan bagi pengguna, timestamp tetap tersimpan UTC di database.
- Belum diuji langsung dengan database produksi milikmu; SQL harus dijalankan hati-hati sesudah backup dan pengujian pada data simulasi.
