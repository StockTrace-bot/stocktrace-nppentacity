import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('index.html');
const login = read('login.html');
const app = read('app.js');
const v21 = read('v21.js');

test('operational UI removes explanatory notes and redundant helper copy', () => {
  assert.doesNotMatch(html, /Dokumentasi dan penanganan selisih stok|Geser tabel|Maks\. 100 MiB per berkas|Data arsip dapat dipulihkan oleh Leader|Pencatatan ini tidak mengubah stok kasir|Persetujuan dan perubahan stok dilakukan di luar StockTrace|Hanya Leader yang dapat mengubah status dan catatan|Pelapor dicatat otomatis dari akun login|Buka halaman untuk memuat|Buka kasus untuk membaca riwayat|Total kasus yang termuat/i);
  assert.doesNotMatch(login, /Sistem Pelaporan & Monitoring Stok/i);
  assert.doesNotMatch(app, /Gunakan Tambah Bukti di bawah ini/);
  assert.match(html, /Penugasan PIC/);
  assert.match(html, /Simpan penugasan PIC/);
  assert.match(html, /Catatan pemeriksaan/);
});

test('password guidance remains visible', () => {
  assert.match(html, /Minimal 12 karakter; gunakan kombinasi huruf, angka, dan simbol/);
  assert.match(html, /Lupa kata sandi\? Hubungi administrator\./);
  assert.match(login, /Lupa kata sandi\? Hubungi administrator\./);
  assert.match(app, /Ganti Kata Sandi/);
});

test('validation, errors, and success confirmations remain available', () => {
  assert.match(app, /Catatan wajib/);
  assert.match(app, /Gagal menyimpan progres/);
  assert.match(app, /Progres pemeriksaan berhasil disimpan/);
  assert.match(app, /Gagal mengganti kata sandi/);
  assert.match(v21, /Gagal menyimpan penerimaan/);
  assert.match(v21, /Status permintaan berhasil diperbarui/);
});

test('technical row-limit and staging instructions are not shown in the UI', () => {
  assert.doesNotMatch(v21, /Batas 5\.000 baris tercapai|cek SQL 10 V2\.1 staging/i);
});

test('export semantics remain intact without duplicate archive counts', () => {
  assert.match(v21, /Selisih = jumlah fisik datang termasuk reject - jumlah dokumen/);
  assert.match(v21, /Diterima layak = jumlah fisik datang - jumlah barang reject/);
  assert.match(v21, /Update stok kasir tetap dilakukan di sistem kasir/);
  assert.doesNotMatch(app, /Total arsip:/);
  assert.doesNotMatch(app, /Sinkronisasi Sheets dan Drive berjalan melalui webhook/);
});
