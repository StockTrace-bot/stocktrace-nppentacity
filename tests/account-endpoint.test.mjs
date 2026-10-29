import test from 'node:test';import assert from 'node:assert/strict';
import security from '../api/account-password.mjs';
import config from '../api/public-config.mjs';
test('security endpoint rejects missing JWT without contacting Google/Supabase',async()=>{
 const env=process.env;env.SUPABASE_URL='https://testing.supabase.co';env.SUPABASE_SERVICE_ROLE_KEY='test_secret';env.SUPABASE_PUBLISHABLE_KEY='test_public';
 const res=await security.fetch(new Request('https://stage.example.com/api/account-password'));
 assert.equal(res.status,401);
});
test('cross-origin password updates are rejected',async()=>{
 const res=await security.fetch(new Request('https://stage.example.com/api/account-password',{method:'POST',headers:{origin:'https://evil.example.net','content-type':'application/json',Authorization:'Bearer fake'},body:'{}'}));
 assert.equal(res.status,403);
});
test('preview with original production Supabase is refused',async()=>{
 const old=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
 process.env.SUPABASE_URL='https://tcwkfsrxjujsuyttxgfz.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test_public';
 try{const r=await config.fetch(new Request('https://stage.example.com/api/public-config'));assert.equal(r.status,503);assert.ok((await r.json()).error.includes('diblokir'));}finally{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
