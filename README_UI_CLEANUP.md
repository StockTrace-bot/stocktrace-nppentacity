# StockTrace V2.3.1 — UI Copy Cleanup

## Cakupan

Pembaruan ini merapikan teks di seluruh halaman operasional StockTrace agar tampil lebih ringkas dan terasa seperti aplikasi kerja sehari-hari.

### Dihapus atau diringkas
- Paragraf deskripsi di dashboard, detail kasus, arsip, penerimaan barang, dan monitoring kasir.
- Penjelasan panjang mengenai tugas Leader/PIC dan proses internal aplikasi.
- Petunjuk geser tabel pada layar kecil.
- Catatan batas ukuran unggahan yang berulang di bawah setiap input.
- Pemberitahuan batas jumlah baris dan instruksi SQL/staging dari pesan pemuatan data.
- Notifikasi jumlah data yang mengulang informasi di dashboard.
- Kalimat tambahan pada konfirmasi berhasil yang tidak diperlukan.

### Tetap dipertahankan
- Nama halaman, judul bagian, label formulir, dan tombol.
- Placeholder singkat yang membantu pengisian.
- Status memuat data dan kondisi data kosong.
- Pesan error, validasi, peringatan akses, serta konfirmasi berhasil/gagal.
- Informasi lupa kata sandi dan panduan penggantian kata sandi.
- Batas validasi unggahan dan aturan proses di sisi kode.

## Dampak teknis

Perubahan hanya pada copy antarmuka, pesan status/konfirmasi, dan pengujian copy. Tidak ada perubahan pada:
- Struktur database, RLS, atau SQL migration.
- Hak akses Leader dan Staff.
- Proses pelaporan, penugasan PIC, progres PIC, arsip/pemulihan, penerimaan barang, atau monitoring permintaan kasir.
- Integrasi Supabase, Google Sheets, Google Drive, OAuth, maupun konfigurasi Vercel.

## Pemeriksaan

- `node --check app.js`
- `node --check v21.js`
- `node --check mobile-nav.js`
- `node --test tests/*.test.mjs`

Hasil pemeriksaan pada paket ini: **89 lulus, 0 gagal**.

Paket ini berisi source code dan belum dideploy ke Vercel. Arsip ZIP yang menjadi basis tidak menyertakan metadata Git, sehingga commit asal tidak dapat diverifikasi secara mandiri.
