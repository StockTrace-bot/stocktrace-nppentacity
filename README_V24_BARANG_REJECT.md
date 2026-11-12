# StockTrace V2.4 — Panduan Barang Reject

## Fungsi baru

Modul **Penerimaan Barang** sekarang mencatat barang yang datang dari pusat dan barang yang ditolak pada tingkat SKU.

### Arti setiap jumlah

- **Jumlah dokumen**: jumlah yang tercantum pada surat jalan/dokumen pusat.
- **Fisik datang**: seluruh barang yang benar-benar tiba, termasuk barang yang kemudian dinyatakan reject.
- **Jumlah reject**: bagian dari jumlah fisik datang yang tidak diterima sebagai barang layak. Nilainya tidak boleh melebihi jumlah fisik datang.
- **Diterima layak**: dihitung otomatis dengan rumus `Fisik datang - Jumlah reject`.
- **Selisih layak - dokumen**: `Diterima layak - Jumlah dokumen`; ini menunjukkan selisih barang yang benar-benar layak diterima terhadap dokumen.
- **Selisih fisik - dokumen**: tetap memakai rumus lama `Fisik datang - Jumlah dokumen` agar catatan historis dan arti selisih lama tidak berubah.
- **Alasan reject**: wajib diisi minimal 3 karakter jika jumlah reject lebih dari 0.

### Bukti pendukung

Saat mengunggah lampiran, pilih kategori **Bukti Penerimaan** atau **Bukti Barang Reject**. Berkas tetap disimpan di Google Drive melalui mekanisme upload dan verifikasi yang sudah digunakan StockTrace.

### Rekap

Informasi reject dan jumlah diterima layak muncul pada rincian penerimaan, daftar penerimaan, ekspor Excel, dan Google Sheets. Kolom baru Google Sheets ditambahkan setelah kolom lama agar urutan kolom yang sudah ada tetap terjaga.

### Pemasangan

1. Buat backup database Production.
2. Jalankan satu kali `sql/15_PENERIMAAN_BARANG_REJECT.sql` di Supabase Production.
3. Deploy source V2.4 ke branch `main`.
4. Setelah deployment Ready, login sebagai Leader dan jalankan sinkronisasi penuh Google Sheets satu kali untuk mengisi kolom tambahan dan data historis.
5. Uji satu dokumen penerimaan percobaan sebelum digunakan untuk transaksi operasional.

Migrasi SQL 15 bersifat additive. Data penerimaan lama tetap dipertahankan dan nilai reject historis otomatis `0`. Jangan menjalankan ulang SQL historis 01–14.

### Pemeriksaan otomatis

Paket mencakup 93 automated tests. Pengujian ekspor Excel menggunakan direktori sementara sistem agar kompatibel dengan Windows dan macOS/Linux.
