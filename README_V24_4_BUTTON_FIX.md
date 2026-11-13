# StockTrace V2.4.4 — Perbaikan Tombol Kirim Laporan

Masalah: pada beberapa perangkat, tombol **Kirim Laporan** tidak tampak walaupun ada di HTML. Tombol lama hanya mengandalkan warna `bg-npnavy` dari Tailwind CDN sehingga kombinasi tombol putih/transparan bisa membuatnya tidak terlihat.

Perubahan:
- Menambahkan stylesheet lokal `stocktrace-actions-safe.css` untuk tombol laporan dan aksi penting lainnya.
- Tombol Kirim Laporan diberi gaya inline minimum sebagai perlindungan jika CSS terlambat dimuat.
- Lebar serta susunan tombol pada HP dibuat jelas; tombol Kirim Laporan berada di atas tombol Batal, dan tetap terlihat pada desktop.
- Jenis tombol tetap `type=submit`. Listener `submitReport` dan validasi/unggah bukti tidak diubah.
- Tidak mengubah database, Supabase, webhook, Google Drive, Google Sheets, maupun role Staff/Leader.

Pemasangan: jalankan `APPLY_STOCKTRACE_V244_TO_MAIN.ps1` di terminal repository asli, setelah mengekstrak ZIP. Script memeriksa repository, membuat backup, memasang CSS serta patch kecil pada index.html, menjalankan tes, lalu meminta konfirmasi PUSH.

Catatan: pengujian otomatis/lokal bukan pengganti pengujian login nyata dan klik Kirim Laporan di Production. Uji terlebih dahulu dengan laporan contoh non-sensitif.
