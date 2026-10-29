# StockTrace V2.1 — Paket sumber terintegrasi, 29 Oktober 2026

**Status:** source code siap untuk **uji staging**, **bukan** konfirmasi bahwa sistem produksi sudah dipasang, lima akun perusahaan sudah aktif, atau integrasi pihak ketiga telah lolos uji langsung. Semua file proyek berada di root ZIP ini; tidak perlu digabung dengan ZIP lama.

## 1. Yang dipertahankan dari V1.2/V2

- Desain dashboard profesional **sidebar navy di sebelah kiri** pada laptop, Android dan iPhone; tombol **Lapor Kasus** tetap di sisi kanan judul. Tidak ada navbar/tombol mengambang bawah.
- Empat KPI dashboard, daftar kasus R1, laporan selisih stok sistem–fisik, bukti dan riwayat kasus, penugasan PIC, keputusan/status Leader, pencarian/filter, rekap/cetak, dan ekspor CSV lama.
- Login melalui **ID akun** `NP-LDR-001` dan `NP-STF-001` sampai `NP-STF-004`, penggantian password, reset lokal administrator (bukan reset publik), pembatasan akses Staff/Leader.
- Supabase Auth/DB, `/api/drive-upload` berbasis resumable upload ke Google Drive sampai 100 MiB per file, unduhan terautentikasi, serta sinkronisasi Google Sheets lama (tab `Kasus`, `Bukti`, `Riwayat`). Tidak ada kredensial dalam ZIP.

## 2. Tambahan yang benar-benar diimplementasikan di V2.1

| Permintaan | Lokasi / alur | Aturan |
| --- | --- | --- |
| Penerimaan barang | Sidebar **Penerimaan Barang** → nomor surat jalan, tanggal, pengirim, SKU | Satu dokumen dapat memuat 1–150 SKU, simpan atomik lewat RPC database. |
| Selisih per SKU | Kolom `Jumlah dokumen`, `Fisik diterima`, `Selisih` | **Selisih = fisik diterima − jumlah di dokumen**. Negatif artinya kurang, positif artinya lebih; berbeda dari R1 (stok fisik − stok sistem). |
| Arsip bukti penerimaan | Lampiran saat input atau tombol **Tambah bukti** pada detail penerimaan | Menggunakan Drive yang sama, tetapi `stocktrace_intake_evidence` terpisah dari bukti R1; unduh melalui otorisasi RLS. Arsip Bukti menampilkan keduanya. |
| Ekspor Excel **asli `.xlsx`** | Penerimaan Barang → **Ekspor Excel .xlsx** | Worksheet `Penerimaan`, `Detail SKU`, `Permintaan Kasir`, `Keterangan`, format OpenXML; tidak berupa CSV dengan ekstensi XLSX. Aman terhadap formula injection karena semua input teks disimpan sebagai inline string. |
| Permintaan update stok kasir | Sidebar **Update Stok Kasir** | SKU, produk, jumlah kasir vs hasil pengecekan, alasan; tautan opsional ke R1/penerimaan; status dan riwayat perubahan. |
| Monitoring kasir | 4 metrik, tabel, filter, detail, riwayat | Staff membuat permintaan; **Leader/Admin** memperbarui status dengan catatan wajib 8 karakter. **Tidak** mengubah sistem kasir resmi. |
| Keamanan data V2.1 | `sql/10_...sql` | RLS tabel baru, mutasi penting via RPC, validasi server, audit status kasir, tidak ada penghapusan data lama. |

**Penting tentang template Excel:** format kerja `.xlsx` telah dibuat untuk kebutuhan tugas, tetapi **template resmi kantor pusat tidak ada dalam ZIP sumber yang diberikan**. Karena itu kesamaan kolom, urutan, formula dan styling dengan template kantor pusat **belum dapat diklaim**. Jika format resmi tersedia, mapping Excel perlu disesuaikan; jangan menyebut hasil ini sebagai dokumen resmi kantor pusat.

## 3. Urutan penerapan yang aman

1. Backup ZIP `main` asli, lalu buat branch pengujian terpisah misalnya `v2-1-staging`. **Jangan overwrite** main sebelum uji dan persetujuan.
2. Siapkan Supabase **staging** terpisah, lengkap dengan struktur V1.2 dan 5 akun pengujian (1 Leader + 4 Staff). Ikuti `README_DEPLOY_STAGING.md`: SQL lama 01–03 hanya dijalankan bila **belum** ada dalam DB tersebut. SQL 05, 08, 09 adalah prasyarat V2, bukan untuk diulang membabi buta di produksi.
3. Setelah V2 siap dan sudah backup, jalankan **hanya SQL tambahan** `sql/10_V2_1_PENERIMAAN_DAN_MONITORING_KASIR_STAGING.sql` pada Supabase STAGING melalui SQL Editor. Ini membuat 5 tabel V2.1, pembatasan RLS, dan 3 RPC; tidak menyentuh isi tabel `cases`, `case_logs`, `evidence_files` lama.
4. Di Vercel Preview, pasang environment variables **STAGING** yang disebut di `ENV_VERCEL_NAMA_SAJA.txt` dan `README_DEPLOY_STAGING.md`; semua secret tetap di Vercel, tidak pernah masuk GitHub/browser. Gunakan folder Google Drive dan Spreadsheet uji, jangan sumber asli bisnis.
5. Publish branch untuk Preview; uji login 5 akun, peran Staff/Leader, menu kiri desktop dan HP, R1, PIC, 100 MiB direct upload, arsip dan unduhan, migrasi, penerimaan dengan beberapa SKU, kasus selisih −1/+1/0, request kasir, riwayat status dan ekspor `.xlsx`.
6. Jalankan **sinkronisasi Google Sheets tiga tab lama** sebagai Leader, cek webhook di Sheets setelah perubahan kasus R1. Modul V2.1 baru menyimpan data di Supabase dan menyediakan ekspor Excel; **belum otomatis dibuatkan tab tambahan** pada Google Sheets lama supaya sinkronisasi yang telah berjalan tidak rusak.
7. Lanjutkan uji semua skenario dari `README_UJI_TERIMA.md`, termasuk versi browser Chrome Android dan Safari iPhone, baru putuskan apakah kode boleh digabungkan ke `main`.

## 4. Hak akses yang sengaja dibatasi

| Tindakan | Staff | Leader |
| --- | :---: | :---: |
| Membuat kasus R1, mengunggah bukti | Ya | Ya |
| Membaca kasus sesuai kebijakan RLS dan melihat riwayat | Ya | Ya |
| Menunjuk PIC / mengubah status R1 | Tidak | Ya |
| Membuat dan membaca penerimaan serta selisih SKU | Ya | Ya |
| Mengunggah/mengunduh bukti penerimaan | Ya | Ya |
| Mengajukan permintaan update kasir | Ya | Ya |
| Mengubah status permintaan kasir (wajib catatan) | Tidak | Ya |
| Sinkronisasi penuh Google Sheets 3 tab lama | Tidak | Ya |

**Tidak ada role kasir/IT/MD yang memperoleh akses menulis langsung ke POS.** Kolom `status_request='Selesai (Dikonfirmasi)'` hanya merepresentasikan konfirmasi tindak lanjut yang dicatat Leader dalam simulasi, bukan bukti perubahan di POS perusahaan.

## 5. Pengujian lokal yang sudah dilaksanakan

- `node --check` semua source JS utama dan API terkait, serta `python -m py_compile scripts/*.py`.
- `node --test tests/*.test.mjs` (37 test lulus pada pemeriksaan paket, termasuk uji receipt Drive yang dimock).
- Uji **browser Chromium dengan Supabase yang dimock**: tambah/hapus baris SKU, hitung selisih, buat dokumen, buat request kasir, ubah status oleh Leader; ekspor file yang berhasil dibuka di `openpyxl` dengan selisih −1 dan sheet status terisi. Ini **bukan** pengujian kredensial, jaringan dan file sungguhan.
- File `.xlsx` diuji sebagai workbook OpenXML sah (bukan ekstensi palsu).

## 6. Hal yang belum bisa diklaim lulus dari arsip kode saja

- Eksekusi SQL 10 pada **database staging aktual**, peran/RLS dengan seluruh lima akun, tidak ada backup pribadi di dalam ZIP, dan penyambungan Vercel Preview ke staging.
- **Google Drive resumable browser upload CORS** pada Chrome Android/Safari iPhone dan upload/unduh file besar yang sesungguhnya, bukan simulasi HTTP. Jangan mengulang file yang gagal tanpa memeriksa Drive karena dapat membuat duplikat.
- Webhook Google Sheets live; sistem baru **tidak** menjanjikan tab tambahan ke Spreadsheet lama.
- Keseragaman piksel dengan screenshot laptop untuk setiap model HP dan kesesuaian template pusat; perlu QA perangkat dan template asli.
- Pemakaian oleh toko secara operasional, keamanan eksternal/pen-test, persetujuan perusahaan, dan disaster-recovery/restore drill.

## 7. File utama untuk diperhatikan

- `index.html`, `app.js`, `v21.js`, `xlsx-export.js`, `stocktrace-professional-rose.css`: antarmuka dan logika.
- `api/drive-upload.mjs`, `api/evidence.mjs`: bukti kasus R1 dan penerimaan, tetap lewat endpoint yang sama.
- `sql/10_V2_1_PENERIMAAN_DAN_MONITORING_KASIR_STAGING.sql`: migrasi tambahan V2.1. **Tidak boleh dijalankan di Supabase produksi tanpa uji dan backup.**
- `README_RESET_DATA.md`: prosedur bersifat manual dan tidak otomatis. **Tidak ada penghapusan database/Drive/Sheets saat deployment.**

Untuk kembali ke versi lama: rollback source code di Vercel/branch. **Jangan DROP** tabel/data V2.1 untuk rollback; tabel baru dapat dibiarkan sementara hingga ada keputusan migrasi data yang aman.
