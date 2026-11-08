# Daftar uji penerimaan StockTrace V2 sebelum go-live

Semua item harus diberi status oleh pengguna pada Preview terisolasi sebelum merge ke main:

- [ ] 5 akun ID Staff/Leader cocok dengan nama, UUID, dan role di Supabase staging.
- [ ] Login ID benar/salah, percobaan berulang, sign-out dan refresh sesi teruji.
- [ ] Tidak ada form email; admin sudah memverifikasi identitas email internal unik bila migrasi dijalankan.
- [ ] Semua Staff/Leader bisa ganti password dengan password lama yang benar.
- [ ] Password sementara setelah reset admin menolak akses data, kemudian wajib diganti.
- [ ] Staff tidak dapat mengubah status, memilih PIC, atau memanggil RPC khusus Leader melalui API.
- [ ] Leader dapat mengubah PIC/status dan log otomatis tercatat.
- [ ] Laptop 1280/1440px, tablet, Android 360/390px, iPhone Safari: sidebar selalu di kiri, tombol Lapor Kasus tetap di kanan, tabel dapat digeser tanpa membuat halaman patah.
- [ ] Upload bukti 5 MiB, 25 MiB, dan 100 MiB berjalan di Drive staging dengan progres, status error jelas, dan tidak menghasilkan file duplikat saat retry.
- [ ] Download besar berfungsi, tidak membuat file menjadi publik, dan Staff tidak bisa membaca bukti di luar RLS.
- [ ] Google Sheets webhook menambah/mengubah data; full sync Leader bekerja.
- [ ] Backup SQL+Auth+RLS berhasil dipulihkan di staging; daftar file Drive yang akan dihapus telah cocok.
- [ ] Jika reset data dilakukan: laporan, riwayat, bukti DB dan Drive 0; Users/Auth tetap 5.
- [ ] Seluruh environment variable Preview/Production dibedakan, dan tidak ada kredensial di GitHub.

**Status saat ZIP dibuat:** hanya tes unit/simulasi dan pemeriksaan sintaks yang dilakukan. Semua uji langsung di atas **belum dikonfirmasi**.
