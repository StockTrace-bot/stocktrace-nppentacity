import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const index = read('index.html');
const login = read('login.html');
const app = read('app.js');
const v21 = read('v21.js');
const publicConfig = read('api/public-config.mjs');
const drive = read('api/drive-upload.mjs');
const idLogin = read('api/id-login.mjs');

test('external UI libraries do not control the login page first paint', () => {
  assert.match(index, /<script defer src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
  assert.match(index, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
  assert.match(index, /rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/);
  assert.doesNotMatch(login, /cdn\.tailwindcss\.com|stocktrace-professional-rose\.css|fonts\.googleapis\.com/);
  assert.match(login, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
  assert.match(login, /<style>[\s\S]*body\.st-login-page[\s\S]*\.st-login-card[\s\S]*<\/style>/);
  assert.match(login, /DOMContentLoaded',initClient/);
});

test('public Supabase configuration is cached briefly and contains only public values', () => {
  assert.match(publicConfig, /public, max-age=300, s-maxage=600, stale-while-revalidate=3600/);
  assert.match(publicConfig, /supabase_url:url,supabase_publishable_key:key/);
  assert.doesNotMatch(publicConfig, /serviceRoleKey|clientSecret|refreshToken/);
  assert.doesNotMatch(app, /fetch\('\/api\/public-config',\{cache:'no-store'\}\)/);
  assert.doesNotMatch(login, /fetch\('\/api\/public-config',\{cache:'no-store'\}\)/);
});

test('dashboard auth/profile/security and initial data loads are parallelized', () => {
  assert.match(app, /const \[profileResult,securityResponse\]=await Promise\.all/);
  assert.match(app, /Promise\.all\(\[directoryTask,loadCases\(\{force:true\}\)\]\)/);
  assert.match(app, /casesLoadedAt/);
  assert.match(app, /casesLoadPromise/);
  assert.match(app, /select\('id_kasus,id_pelapor,sku_produk,nama_produk/);
});

test('evidence uploads use two-file batches and batch metadata writes', () => {
  assert.match(app, /for\(let start=0;start<files\.length;start\+=2\)/);
  assert.match(app, /const results=await Promise\.all\(batch\.map/);
  assert.match(app, /sb\.from\(table\)\.insert\(records\)/);
  assert.match(v21, /uploadFileBatch\(files,id,session/);
});

test('Drive upload reuses short-lived OAuth token and folder permission checks', () => {
  assert.match(drive, /googleTokenExpiresAt/);
  assert.match(drive, /googleTokenPending/);
  assert.match(drive, /folderAccessCache/);
  assert.match(drive, /if \(action === 'start'\) \{\s*\/\/ Folder permission is checked once/s);
  assert.match(drive, /const \[profileResponse, recordResult\] = await Promise\.all/);
  assert.doesNotMatch(drive, /googleAccountEmail/);
});

test('ID login performs rate gate and internal ID lookup concurrently', () => {
  assert.match(idLogin, /const \[gate,map\]=await Promise\.all/);
});
