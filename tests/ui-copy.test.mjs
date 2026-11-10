import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('index.html');
const login = read('login.html');
const app = read('app.js');
const v21 = read('v21.js');

test('user-facing StockTrace copy stays concise and avoids implementation details', () => {
  assert.doesNotMatch(html, /Menampilkan maksimal 500 kasus|akses RLS|kebijakan database \(RLS\)/i);
  assert.match(html, /Maks\. 100 MiB per berkas/);
  assert.match(html, /Data arsip dapat dipulihkan oleh Leader/);
  assert.doesNotMatch(html, /Jumlah kasus dan pola temuan|Rekap jumlah kasus, bukan estimasi/i);
  assert.match(html, /Pencatatan ini tidak mengubah stok kasir/);
  assert.match(html, /Persetujuan dan perubahan stok dilakukan di luar StockTrace/);
  assert.match(html, /Lupa kata sandi\? Hubungi administrator\./);
  assert.doesNotMatch(html, /Kelola keamanan akun StockTrace kamu|reset melalui Supabase|Jangan membagikan password|fungsi database|Memuat data dari Supabase/i);
  assert.match(login, /Lupa kata sandi\? Hubungi administrator\./);
  assert.doesNotMatch(v21, /Simulasi Akademik|Rangkuman berdasarkan data yang termuat|belum diverifikasi identik/i);
  assert.match(v21, /Selisih = jumlah fisik diterima - jumlah dokumen/);
  assert.match(v21, /Update stok kasir tetap dilakukan di sistem kasir/);
  assert.match(app, /Total arsip: \$\{rows\.length\} item/);
  assert.doesNotMatch(app, /Sinkronisasi Sheets dan Drive berjalan melalui webhook/);
});
