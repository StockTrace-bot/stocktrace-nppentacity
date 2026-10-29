# Reset laporan, Google Sheets, dan bukti Google Drive — PROSEDUR TERPISAH

Penghapusan merupakan tindakan destruktif. **Source ZIP tidak menjalankan reset secara otomatis.** Gunakan izin dari pemilik data dan verifikasi cakupan file sebelum tindakan. Backup V1.2 yang ada berisi CSV/XLSX snapshot; **itu belum tentu setara dump lengkap Auth/DB/RLS**. Siapkan dump yang dapat dipulihkan lalu uji restore dulu.

1. Pastikan proyek/folder Drive yang sedang digunakan benar, dan data uji/operasional sudah dibedakan.
2. Jalankan `sql/06_AUDIT_BEFORE_RESET_ONLY.sql` (read-only); ekspor `cases`, `evidence_files`, `case_logs`, `users` + database schema, Auth & policy. Simpan file privat, tidak ke GitHub.
3. Ekspor `evidence_files.csv` dari DB dengan setidaknya `drive_file_id,id_kasus`. Verifikasi *fileId* benar-benar milik folder bukti StockTrace, tidak tercampur file lain.
4. Di terminal privat dengan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, dan GOOGLE_DRIVE_FOLDER_ID yang tepat, jalankan: `python scripts/drive_trash_evidence.py --csv evidence_files.csv` untuk **dry-run**. Tinjau daftar file. Setelah setuju: `python scripts/drive_trash_evidence.py --csv evidence_files.csv --execute --confirm SAYA_SETUJU_PINDAHKAN_BUKTI_STOCKTRACE_KE_TRASH`.
5. **Hapus permanen jika memang diperlukan:** setelah verifikasi file yang di-Trash, jalankan `python scripts/drive_delete_permanent.py --csv evidence_files.csv` (dry-run). Lalu, **hanya atas persetujuan eksplisit pemilik data**, jalankan versi `--execute --confirm SAYA_SETUJU_HAPUS_PERMANEN_BUKTI_STOCKTRACE`. Penghapusan permanen tidak dapat dibatalkan.
6. Setelah Drive selesai diverifikasi dan backup terbukti bisa dipulihkan, audit target DB lalu tinjau `sql/07_RESET_DATA_HANYA_SETELAH_BACKUP_DAN_DRIVE_BERES.sql`. **SQL 07 sengaja dikunci dan perlu aktivasi manual**. Menghapus 3 tabel kasus tidak boleh menghapus `users` maupun `auth.users`.
7. Google Sheets: Leader menjalankan **Sinkronkan Google Sheets** (full), memuat ulang tab `Kasus`, `Bukti`, dan `Riwayat` dengan 0 data, tetap mempertahankan header. Tab turunan berisi rumus, bukan dihapus. Verifikasi seluruh dashboard 0, atau tangani formula/filter yang menyisakan data lama.
8. Pastikan lima akun ID dan role tetap berjalan, PIC hanya menyentuh kasus baru, dan uji satu laporan simulasi baru bila diizinkan.

**Tidak ada penghapusan data dari sesi ChatGPT ini.** Jangan menulis refresh token atau service-role key dalam file ZIP/repository.
