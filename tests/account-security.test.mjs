import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const root=new URL('../',import.meta.url);const f=p=>readFileSync(new URL(p,root),'utf8');
test('server password change verifies current password before admin update',()=>{const x=f('api/account-password.mjs');assert.ok(x.indexOf("grant_type=password")<x.indexOf("method:'PUT'"));assert.match(x,/stocktrace_password_gate/);assert.match(x,/must_change_password:false/);});
test('no email login form or public administrator reset endpoint',()=>{assert.match(f('login.html'),/id="loginId"/);assert.doesNotMatch(f('login.html'),/type="email"/);assert.doesNotMatch(f('api/account-password.mjs'),/action==='admin_reset'/);});
test('guard on restrictive RLS and SECURITY DEFINER mutations',()=>{const x=f('sql/08_ACCOUNT_SECURITY_V2_STAGING.sql');assert.match(x,/AS RESTRICTIVE FOR ALL/);const y=f('sql/09_RPC_GUARD_FORCED_PASSWORD.sql');assert.equal((y.match(/public\.stocktrace_can_use_app\(\)/g)||[]).length,2);});
test('data deletion locked by default',()=>assert.match(f('sql/07_RESET_DATA_HANYA_SETELAH_BACKUP_DAN_DRIVE_BERES.sql'),/BELUM_DIAKTIFKAN/));
