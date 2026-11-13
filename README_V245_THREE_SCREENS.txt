STOCKTRACE V2.4.5 — PATCH KHUSUS TIGA SCREENSHOT

Hanya memperbaiki tampilan berikut:
1. Ekspor CSV: kontras navy-putih agar terbaca.
2. Rincian SKU: angka/hasil rata tengah; SKU dan Produk diperbesar di HP.
3. Akun Saya: bantuan 'Lupa kata sandi? Hubungi administrator.' rata tengah.

Patch ini hanya menambah satu CSS lokal dan menautkannya ke index.html.
Tidak mengubah login, JavaScript, Supabase, Google Sheets/Drive, webhook, atau SQL.
Tidak mengulang perbaikan tombol lain yang sudah berhasil.

Gunakan perintah dari folder repository Git StockTrace main.
Script akan membuat backup branch, memeriksa source, menjalankan npm test,
meminta konfirmasi PUSH, lalu push ke main.
Jika muncul error, JANGAN jalankan git push manual.
