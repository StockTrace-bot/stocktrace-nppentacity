import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const f=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('preview blocked from accidentally using original prod backend',()=>assert.match(f('api/public-config.mjs'),/VERCEL_ENV==='preview'/));
test('browser reads public deployment config',()=>{assert.match(f('app.js'),/fetch\('\/api\/public-config'/);assert.match(f('login.html'),/fetch\('\/api\/public-config'/);});
