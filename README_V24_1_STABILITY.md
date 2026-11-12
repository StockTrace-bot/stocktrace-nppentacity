# StockTrace V2.4.1 — Stability Patch

## Tujuan
- Menghilangkan kilatan tombol putih pada sidebar saat login/refresh sebelum Tailwind CDN selesai dimuat.
- Membuat pemeriksaan header Google Sheets toleran terhadap spasi Unicode, non-breaking spaces, variasi tanda hubung, dan kapitalisasi yang tidak mengubah makna header.
- Memberikan diagnostik kolom yang lebih jelas jika benar-benar ada header yang berbeda.

## Sinkronisasi otomatis
Webhook Supabase yang sudah terpasang tetap digunakan. Full Sync terakhir telah menulis ulang header canonical pada tab Penerimaan dan Detail SKU. Respons 409 yang terlihat sebelumnya berasal dari request sebelum header diperbaiki; respons tersebut adalah riwayat, bukan status saat ini. Perubahan data baru akan tetap dikirim oleh webhook yang sudah terpasang.

Tidak ada SQL migration baru, tidak ada perubahan tabel Supabase, tidak ada penghapusan data, dan tidak perlu membuat webhook baru. Tombol Full Sync tetap tersedia sebagai alat pemulihan manual.

## Validasi
Jalankan `npm test`. Patch menambahkan regression test untuk sidebar, normalisasi header, dan pemetaan webhook.
