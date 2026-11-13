import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../stocktrace-actions-safe.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

test('report submit remains a real submit button and is styled locally',()=>{
  assert.match(html,/<button\b(?=[^>]*id="btnSubmitLaporan")(?=[^>]*type="submit")(?=[^>]*st-report-submit)[^>]*>Kirim Laporan<\/button>/s);
  assert.match(html,/<link rel="stylesheet" href="stocktrace-actions-safe\.css\?v=2\.4\.4">/);
  assert.match(css,/#formLaporanLengkap #btnSubmitLaporan\s*\{/);
  assert.match(css,/display:\s*inline-flex\s*!important/);
  assert.match(css,/background-color:\s*#1e293b\s*!important/);
  assert.match(css,/color:\s*#ffffff\s*!important/);
});

test('report save and cancel are distinct actions on mobile and desktop',()=>{
  assert.match(css,/@media\s*\(max-width:\s*767px\)/);
  assert.match(css,/flex-direction:\s*column-reverse/);
  assert.match(html,/onclick="showView\('dashboard'\)"[^>]*>Batal<\/button>/);
  assert.match(html,/id="formLaporanLengkap"/);
  assert.match(app,/el\('formLaporanLengkap'\)\.addEventListener\('submit',submitReport\)/);
  assert.match(app,/el\('btnSubmitLaporan'\)/);
});

test('other critical save and upload buttons retain local visible styles',()=>{
  for(const id of ['btnExtraEvidence','savePasswordButton','btnSaveIntake','btnSubmitCashier']){
    assert.match(css,new RegExp('#'+id+'\\b'));
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});
