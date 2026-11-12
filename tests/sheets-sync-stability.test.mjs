import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('index.html','utf8');
const sync=fs.readFileSync('api/sheets-sync.mjs','utf8');

test('critical sidebar colors are available before deferred Tailwind initializes',()=>{
  assert.match(html,/<style id="stocktrace-critical-sidebar">/);
  assert.match(html,/#appSidebar \.st-sidebar-nav > button/);
  assert.match(html,/background-color:\s*transparent\s*!important/);
  assert.match(html,/color:\s*#f8fafc\s*!important/);
  assert.match(html,/background-color:\s*#334155\s*!important/);
});

test('Google Sheets header validation normalizes visually equivalent Unicode and spacing',()=>{
  assert.match(sync,/function normalizeSheetHeader\(value\)/);
  assert.match(sync,/normalize\('NFKC'\)/);
  assert.match(sync,/\\u00A0/);
  assert.match(sync,/\\u2010-\\u2015/);
  assert.match(sync,/normalizeSheetHeader\(visible\[index\]\)!==normalizeSheetHeader\(label\)/);
});

test('automatic intake and cashier webhook table mappings remain enabled',()=>{
  for(const table of ['stocktrace_intakes','stocktrace_intake_items','stocktrace_intake_evidence','stocktrace_cashier_requests','stocktrace_cashier_logs']){
    assert.match(sync,new RegExp(table));
  }
  assert.match(sync,/const webhook=constantTimeEqual\(secret,getWebhookSecret\(\)\)/);
  assert.match(sync,/const action=body\.type==='DELETE'\?await deleteOne/);
});
