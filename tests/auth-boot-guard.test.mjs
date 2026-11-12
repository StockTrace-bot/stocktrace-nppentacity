import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

test('application shell is hidden on the very first paint until auth is verified', () => {
  assert.match(html, /<body class="st-auth-pending[^"]*"/);
  assert.match(html, /body\.st-auth-pending #appSidebar[\s\S]*?display:\s*none\s*!important/);
  assert.match(html, /body\.st-auth-pending \.st-main/);
  assert.match(html, /id="authBootScreen"/);
  assert.match(html, /Memeriksa sesi dan hak akses/);
});

test('auth boot is released only after profile and security checks', () => {
  const checkAuth = app.slice(app.indexOf('async function checkAuth(){'), app.indexOf('async function syncSheetsNow(){'));
  assert.match(checkAuth, /sb\.auth\.getUser\(\)/);
  assert.match(checkAuth, /profileResult/);
  assert.match(checkAuth, /securityResponse/);
  assert.ok(checkAuth.indexOf('finishAuthBoot();') > checkAuth.indexOf('securityData.must_change_password'));
  assert.match(checkAuth, /if\(mustChangePassword\)[\s\S]*?showView\('account'\);[\s\S]*?finishAuthBoot\(\)/);
});

test('auth/profile/bootstrap failures keep the application shell hidden', () => {
  assert.match(app, /function showAuthBootError\(message\)/);
  assert.match(app, /showAuthBootError\(e\.message/);
  assert.doesNotMatch(app, /catch\(e\)\{\s*mustChangePassword=true;document\.body\.classList\.add\('st-password-required'\);showView\('account'\)/);
});
