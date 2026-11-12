# Progres Pemeriksaan PIC

1. Deploy source StockTrace yang memuat perubahan progres PIC.
2. Di Supabase project StockTrace yang sama, buka **SQL Editor**.
3. Jalankan `sql/14_PIC_PROGRESS_UPDATE.sql` satu kali.
4. Login sebagai Staff yang ditunjuk PIC, buka kasus melalui filter **PIC saya**, lalu isi progres dan catatan pemeriksaan.
5. Login Leader untuk melihat progres di detail kasus. Perubahan status final tetap hanya melalui panel Leader.

Migrasi ini menambahkan tabel progres terpisah dan RPC khusus PIC. Migrasi tidak mengubah `status_kasus`, tidak menghapus data, dan tidak mengubah webhook Google Sheets/Drive.
