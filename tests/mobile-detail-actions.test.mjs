import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code=fs.readFileSync('v21.js','utf8');
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

test('detail records match IDs consistently and scroll into view on mobile',()=>{
  assert.match(code,/String\(x\.id_intake\)===key/);
  assert.match(code,/String\(x\.id_request\)===key/);
  assert.match(code,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
});

test('detail actions have an accessible, finger-sized touch target',()=>{
  assert.match(code,/aria-label="Buka rincian penerimaan/);
  assert.match(code,/aria-label="Buka detail permintaan/);
  assert.match(css,/\.st-open-detail-action\s*\{/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/touch-action:manipulation/);
});
