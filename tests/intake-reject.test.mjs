import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const code=fs.readFileSync('v21.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const migration=fs.readFileSync('sql/15_PENERIMAAN_BARANG_REJECT.sql','utf8');
const sheets=fs.readFileSync('api/sheets-sync.mjs','utf8');

test('intake UI captures reject quantity, accepted quantity, and reason per SKU',()=>{
  for(const field of ['qty_rejected','qty_accepted','reject_reason'])assert.match(code,new RegExp(`data-field="${field}"`));
  assert.match(code,/r\.qty_rejected>r\.qty_received/);
  assert.match(code,/r\.qty_rejected>0&&r\.reject_reason\.length<3/);
  assert.match(html,/Jumlah reject/);
  assert.match(html,/Diterima layak/);
});

test('intake evidence has explicit receipt/reject category and passes it to metadata',()=>{
  assert.match(html,/id="intakeEvidenceType"/);
  assert.match(html,/value="Bukti Barang Reject"/);
  assert.match(code,/extraFields:\{evidence_type:evidenceType\}/);
  assert.match(app,/options\.extraFields/);
  assert.match(migration,/evidence_type text NOT NULL DEFAULT 'Bukti Penerimaan'/);
});

test('reject migration is additive, validates counts, and remains backward compatible',()=>{
  assert.match(migration,/qty_accepted integer GENERATED ALWAYS AS \(qty_received - qty_rejected\) STORED/);
  assert.match(migration,/qty_rejected <= qty_received/);
  assert.match(migration,/IF NOT \(v_item \? 'qty_rejected'\) THEN\s+v_rejected:=0/s);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.stocktrace_create_intake/);
  assert.doesNotMatch(migration,/DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('Excel and Google Sheets include reject and accepted quantities',()=>{
  assert.match(code,/Qty Reject/);
  assert.match(code,/Qty Diterima Layak/);
  assert.match(code,/Selisih Layak - Dokumen/);
  assert.match(sheets,/Qty Reject/);
  assert.match(sheets,/Qty Diterima Layak/);
  assert.match(sheets,/Selisih Layak - Dokumen/);
  assert.match(sheets,/summary\.totalReject/);
  assert.match(sheets,/range:a1\('Penerimaan',`L\$\{row\}:M\$\{row\}`\)/);
});
