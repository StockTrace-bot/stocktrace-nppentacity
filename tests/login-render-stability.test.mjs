import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('login page is fully styled by critical inline CSS without Tailwind or remote stylesheets', () => {
  assert.match(login, /<style>[\s\S]*body\.st-login-page[\s\S]*\.st-login-card[\s\S]*\.st-login-input[\s\S]*\.st-login-button[\s\S]*<\/style>/i);
  assert.doesNotMatch(login, /cdn\.tailwindcss\.com|stocktrace-professional-rose\.css|fonts\.googleapis\.com|unpkg\.com\/@phosphor-icons/i);
  assert.equal((login.match(/<link\b[^>]*rel=["']stylesheet["']/gi) || []).length, 0, 'Login must not wait for a remote stylesheet to become styled');
  assert.match(login, /class="st-login-card"/);
  assert.match(login, /class="st-login-input"/);
  assert.match(login, /class="st-login-button" disabled/);
});

test('login keeps the existing ID-authentication and profile-verification flow', () => {
  assert.match(login, /fetch\('\/api\/id-login'/);
  assert.match(login, /sb\.auth\.setSession/);
  assert.match(login, /\.from\('users'\)/);
  assert.match(login, /\.eq\('id_user',\s*authData\.user\.id\)/);
  assert.match(login, /window\.location\.replace\('index\.html'\)/);
  assert.match(login, /btn\.disabled\s*=\s*false/);
});

test('initial session screen appears only if authentication check takes longer than a short grace period', () => {
  assert.match(index, /body\.st-auth-pending #appSidebar[\s\S]*?display:\s*none\s*!important/);
  assert.match(index, /animation:\s*st-auth-boot-reveal\s+\.12s\s+ease\s+180ms\s+both/);
  assert.match(index, /@keyframes st-auth-boot-reveal/);
  assert.match(index, /prefers-reduced-motion:\s*reduce/);
});
