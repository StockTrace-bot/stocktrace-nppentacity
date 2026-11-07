# StockTrace V2.1 — penyesuaian kewenangan Leader (staging)

Paket ini merevisi paket asli StockTrace V2.1; hanya fungsi yang terkait izin Leader/PIC/status/sinkronisasi manual dan pesan UI terkait yang diubah. Tidak mengubah data produksi dan tidak menyediakan kredensial.

## Aturan final
- Staff, Leader dan Admin dapat **membaca semua laporan R1** karena SQL 02 tetap tidak diubah.
- **Hanya pengguna dengan role persis `Leader`** (`lower(btrim(role))='leader'`) boleh menetapkan/mengganti/melepas PIC serta mengubah status R1; status kasir V2.1 dan sinkronisasi penuh manual Google Sheets juga mengikuti pembatasan Leader.
- PIC tetap berupa tugas yang diberikan kepada akun dengan role `Staff`, **bukan** role akun baru.
- Admin tetap dapat membaca laporan dan mengakses tindakan non-keputusan sesuai policy lain yang sudah ada. Pengelolaan akun Supabase oleh administrator proyek adalah wewenang terpisah dan tidak bisa dibatasi dengan kebijakan aplikasi ini.

## Posisi database staging saat paket dibuat
- SQL base schema, SQL 01, dan SQL 02 sudah dieksekusi di `StockTrace-V2-Staging` menurut hasil SQL Editor yang dikirim pengguna.
- SQL 03 **belum** dijalankan.
- Project `StockTrace-DB` (produksi lama) **jangan disentuh**.

## Urutan pemasangan — satu langkah pada satu waktu
1. **Di Supabase staging**: jalankan `sql/03_AKTIFKAN_PIC_V1_2_JALANKAN_SEKALI.sql` versi paket INI **sekali**, setelah mengecek proyek aktif. File tersebut mengubah helper `stocktrace_is_leader()` menjadi Leader-only dalam transaksi yang sama dengan penambahan kolom PIC. Jangan menjalankan versi SQL 03 lama.
2. Verifikasi dengan SQL Editor (read-only):

   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='cases'
     AND column_name IN ('pic_id','pic_nama','pic_ditetapkan_pada')
   ORDER BY column_name;

   SELECT pg_get_functiondef('public.stocktrace_is_leader()'::regprocedure);
   ```

   Hasil yang diharapkan: 3 kolom PIC dan fungsi dengan syarat `lower(btrim(u.role)) = 'leader'`.
3. Setelah SQL03 berhasil, lanjutkan SQL04 (read-only) dan pembuatan akun uji, kemudian migrasi 05, 08, 09, 10 sesuai README asli dan hasil pemeriksaan setiap tahap. SQL07 adalah **reset data**: jangan dijalankan saat pemasangan normal.
4. **GitHub**: mengganti file dalam branch `v2-1-staging` dengan versi paket ini (jangan merge ke `main`), terutama `app.js`, `v21.js`, `index.html`, `api/sheets-sync.mjs`, serta SQL terkait. Deploy melalui Vercel Preview branch yang sama dan verifikasi environment staging.
5. **Pengujian akses nyata** dengan akun uji: Leader berhasil ubah status, assign PIC, status kasir, sinkronisasi penuh; Staff/Admin bisa baca semua R1 tetapi operasi Leader ditolak meski dipanggil langsung melalui RPC/API (bukan hanya tombol hilang). Uji akses tidak dapat dijamin hanya dari pemeriksaan kode.

## Perubahan yang sengaja tidak dilakukan
- SQL 02 tidak diubah; izin baca semua laporan harus tetap berlaku.
- Kode upload bukti, login ID, penyimpanan dan ekspor data tidak diubah.
- Belum ada perubahan apa pun di project Supabase/Vercel/GitHub secara langsung; paket ini hanya file siap diterapkan.
- User dengan akses admin tingkat proyek Supabase atau service-role tidak tercakup pembatasan role aplikasi.
