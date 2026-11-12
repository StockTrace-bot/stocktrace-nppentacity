import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login=fs.readFileSync('login.html','utf8');
const css=fs.readFileSync('stocktrace-professional-rose.css','utf8');
const app=fs.readFileSync('app.js','utf8');

test('login card is centered vertically and horizontally in the viewport',()=>{
  assert.match(login,/<body class="st-login-page/);
  assert.match(login,/body\.st-login-page\s*\{[^}]*flex-direction:column!important/s);
  assert.match(login,/body\.st-login-page\s*\{[^}]*justify-content:center!important/s);
  assert.match(login,/min-height:100dvh!important/);
  assert.match(login,/class="st-login-card/);
});

test('archive restore action stays on one line on mobile',()=>{
  assert.match(app,/class="st-restore-action" data-restore-type=/);
  assert.match(css,/\.st-restore-action\s*\{[^}]*white-space:nowrap!important/s);
  assert.match(css,/#view-archive #archiveBody td:last-child\s*\{[^}]*min-width:88px/s);
  assert.match(css,/white-space:nowrap!important/);
});
