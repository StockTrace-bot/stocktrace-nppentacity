import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code=fs.readFileSync('v21.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('stocktrace-professional-rose.css','utf8');

test('intake Buka action binds directly to generated mobile button',()=>{
  assert.match(code,/querySelectorAll\('button\[data-open-intake\]'\)/);
  assert.match(code,/button\.addEventListener\('click',event=>/);
  assert.match(code,/v21OpenIntake\(id,\{scroll:true\}\)/);
  assert.doesNotMatch(code,/el\('intakesBody'\)\.addEventListener\('click'/);
});

test('cashier Detail action binds directly and reports open failures',()=>{
  assert.match(code,/querySelectorAll\('button\[data-open-cashier\]'\)/);
  assert.match(code,/v21OpenCashier\(id,\{scroll:true\}\)\.catch/);
  assert.doesNotMatch(code,/el\('cashierBody'\)\.addEventListener\('click'/);
});

test('detail records match IDs consistently and scroll only the app content pane on mobile',()=>{
  assert.match(code,/String\(x\.id_intake\)===key/);
  assert.match(code,/String\(x\.id_request\)===key/);
  assert.match(code,/scroller&&scroller\.contains\(node\)/);
  assert.match(code,/scroller\.scrollTo\(\{top:nextTop,behavior:'smooth'\}\)/);
});

test('detail actions remain accessible, finger-sized, plain blue underlined text links',()=>{
  assert.match(code,/aria-label="Buka rincian penerimaan/);
  assert.match(code,/aria-label="Buka detail permintaan/);
  assert.match(css,/\.st-open-detail-action\s*\{/);
  assert.match(css,/min-height:38px!important/);
  assert.match(css,/text-decoration:underline!important/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/border:0!important/);
  assert.match(css,/button\.st-open-detail-action,[\s\S]*?\{[^}]*background:transparent!important/s);
  assert.match(css,/button\.st-open-detail-action,[\s\S]*?\{[^}]*border:0!important/s);
  assert.match(html,/stocktrace-professional-rose\.css\?v=2\.3\.1-plain-links/);
});

test('mobile toolbar remains visible and the content pane scrolls independently',()=>{
  assert.match(html,/<header id="appToolbar" aria-label="Toolbar utama"/);
  assert.match(css,/#appToolbar\s*,\s*\.st-main>header/);
  assert.match(css,/display:flex!important/);
  assert.match(css,/z-index:60!important/);
  assert.match(css,/\.st-main\s*\{[^}]*min-height:0!important/s);
  assert.match(css,/\.st-main>\.flex-1\.overflow-y-auto\s*\{[^}]*overflow-y:auto!important/s);
});
