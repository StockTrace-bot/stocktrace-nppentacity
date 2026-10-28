# STOCKTRACE — Integrated Release (untuk struktur Supabase asli)

**Status:** Kandidat integrasi yang telah diuji secara simulasi, **belum** diuji pada database live kamu.

Dibuat dari `StockTrace_Source_Terkini.zip` yang diunggah pengguna, **bukan** dari source versi lama. Halaman login, About, Privacy, Terms, dan CSS publik dari sumber dipertahankan. Google OAuth **tidak** ditulis dalam source (tetap melalui Environment Variables Vercel).

## Fitur yang sudah ada dalam satu paket

- Login Supabase (dipertahankan), profil Staff dan Leader.
- Dashboard kasus, jumlah terbuka/selesai/menunggu IT/MD, pencarian dan filter status.
- Buat kasus selisih stok; validasi jumlah dan otomatis hitung `stok_fisik - stok_sistem`.
- Upload banyak berkas secara **berurutan**, masing-masing maksimal 4 MB, melalui endpoint Vercel / Google Drive yang sudah ada.
- Kasus disimpan sebelum upload; jika upload gagal, kasus tetap ada untuk diisi ulang bukti.
- Detail kasus, tambah bukti ke kasus yang sama, timeline audit, dan perubahan status+catatan melalui RPC khusus Leader/Admin.
- Arsip bukti yang aksesnya mengikuti RLS kasus, unduh melalui `/api/evidence` dengan sesi Supabase (Google Drive tidak perlu di-*share* publik).
- Rekap per status/SKU dan CSV; tombol cetak ke PDF via fitur cetak browser.
- Riwayat pembuatan kasus, penambahan bukti, dan perubahan status dicatat oleh trigger/fungsi Supabase, bukan bisa diubah sembarang pengguna.

## Struktur database yang tepat (tidak ditambah kolom duplikat)

- `cases.status_kasus`, `cases.created_at`
- `case_logs.waktu_aksi`, `case_logs.id_log` (UUID default tetap)
- `evidence_files.waktu_unggah`, `evidence_files.id_file` (UUID default tetap)
- `users.id_user`, `users.role`, `users.nama_lengkap`

## Langkah pemasangan — penting urutannya

### 0. Simpan backup asli

Backup CSV 4 tabel serta `schema.sql`, `roles.sql`, `data.sql` dan ZIP yang sudah kamu buat disimpan **pribadi**, BUKAN di GitHub publik. Keberhasilan ekspor **belum** sama dengan uji pemulihan database. Simpan juga arsip source versi sebelumnya untuk rollback.

### 1. Tinjau SQL PRECHECK

Buka Supabase > SQL Editor. Jalankan **hanya** `sql/00_PERIKSA_SEBELUM_MIGRASI.sql` (read-only). Pastikan empat tabel dan policy persis seperti yang sudah kamu tampilkan; cek apakah terdapat trigger INSERT tambahan. Jika ada trigger asing, jangan jalankan migrasi dulu.

### 2. Migrasi database dengan satu file

Jika precheck cocok, setelah backup disimpan, buka **SQL Editor > New query**, salin isi `sql/01_MIGRASI_FINAL_SESUAI_DATABASE.sql` dan jalankan **sekali**.

Migrasi **tidak menghapus tabel atau data**, tetapi mengubah kebijakan RLS dan izin langsung pada empat tabel. Bila muncul SQL error, hentikan (transaksi akan rollback) lalu periksa error. **Jangan** menjalankan SQL paket sebelumnya.

Kewenangan baru:

- **Staff**: baca hanya `cases` yang dilaporkan oleh akun sendiri dan bukti/log kasus tersebut; dapat membuat kasus dan metadata bukti kasusnya.
- **Leader/Admin**: baca kasus seluruh gerai dan tulis tindak lanjut melalui `stocktrace_update_case_status`.
- Semua akun login **tidak** lagi bisa melakukan update/delete/truncate langsung pada tabel utama. `case_logs` ditulis otomatis oleh trigger atau prosedur database.
- Pengelolaan akun dan role dilakukan oleh admin Supabase, **bukan** tombol terbuka di frontend.

### 3. Salin source ke folder Git lokal

1. Ekstrak ZIP paket ini ke folder sementara (jangan ke Documents backup pribadi).
2. Buka folder lokal repo `C:\Users\hilmi\Downloads\stocktrace-app`.
3. Salin **file utama** dari paket ke root repo: `index.html`, `app.js`, `login.html`, `package.json`, `about.html`, `privacy.html`, `terms.html`, `public.css` dan **folder `api`** (memuat `upload.mjs` dan `evidence.mjs`). Boleh simpan folder `sql` ke repo karena script ini tidak mengandung data pengguna ataupun kredensial, tetapi tidak diwajibkan.
4. **Jangan** salin `.env`, Refresh Token Google, Client Secret, backup CSV, `data.sql`, atau backup ZIP ke GitHub.
5. Pastikan bukan struktur bertingkat `stocktrace-app/stocktrace_integrated_final/api` tetapi langsung `stocktrace-app/api`.

### 4. Push menggunakan PowerShell

```powershell
cd C:\Users\hilmi\Downloads\stocktrace-app
git status
git add index.html app.js login.html package.json about.html privacy.html terms.html public.css api
# opsional jika ingin menyimpan migration source: git add sql
git commit -m "StockTrace integrated version sesuai database asli"
git pull --rebase origin main
git push origin main
```

Jika ada konflik atau error, hentikan dan jangan `git push --force`.

### 5. Uji Vercel dan dua role

1. Vercel > Deployments terbaru harus **Ready**. Buka website, paksa muat ulang **Ctrl+Shift+R**.
2. `/api/upload` (GET) menunjukkan konfigurasi backend yang terdeteksi. **Tidak membuktikan upload sampai selesai**.
3. Dengan **akun Staff**, buat kasus uji `TEST-001`, stok sistem 10, fisik 8; unggah 2 file foto/PDF kecil. Cek kasus dan bukti di Google Drive.
4. Cek tambahan bukti, arsip, dan unduh aman; jangan ubah izin file menjadi publik.
5. Dengan **akun Leader**, tulis catatan min. 8 karakter dan ubah status, lalu buka Timeline.
6. Pastikan Staff tidak dapat mengubah status, bahkan jika mencoba permintaan API langsung. Cek ekspor CSV dan print PDF.
7. Hapus / arsipkan data tes sesuai kebijakan admin; aplikasi sengaja tidak menambahkan tombol hapus bukti audit.

## Keterbatasan / pekerjaan produksi

- File yang lebih besar dari 4 MB (termasuk video unboxing besar) memerlukan direct/resumable upload terpisah. Membesarkan batas HTML saja tidak menyelesaikan batas Vercel Functions.
- Refresh Token Google pada OAuth berstatus **Testing** biasanya kedaluwarsa sekitar 7 hari untuk scope Drive; gunakan konfigurasi OAuth permanen yang disetujui pemilik akun dan kebijakan Google sebelum dipakai jangka panjang.
- Jika Google Drive menyimpan file tetapi penyimpanan metadata Supabase gagal, harus ada rekonsiliasi manual dari Drive. Sistem memperingatkan pengguna agar tidak mengulang kasus yang sama.
- Bukti masih bergantung pada keaslian unggahan manusia; belum ada verifikasi terhadap stok POS asli, chain-of-custody penuh, tanda tangan digital, atau integrasi langsung dengan sistem IT Nada Puspita.
- Analitik mengambil maksimum 500 kasus terbaru yang dapat diakses. Belum paginasi seluruh arsip.
- Proyek ini adalah prototipe akademik sampai keamanan, SOP, retensi, izin data perusahaan, serta pengujian di lingkungan nyata disetujui.

**Jangan** menaruh kredensial Vercel/Google atau data operasional asli dalam repository publik atau screenshot.
