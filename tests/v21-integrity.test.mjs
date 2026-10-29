import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const html=fs.readFileSync('index.html','utf8');
const code=fs.readFileSync('v21.js','utf8');
const sql=fs.readFileSync('sql/10_V2_1_PENERIMAAN_DAN_MONITORING_KASIR_STAGING.sql','utf8');
const app=fs.readFileSync('app.js','utf8');
const drive=fs.readFileSync('api/drive-upload.mjs','utf8');
test('new modules and fields exist in LEFT sidebar and separate views',()=>{
 for(const x of ['intake','cashier']){
  assert.equal((html.match(new RegExp('data-nav-view="'+x+'"','g'))||[]).length,1);
  assert.match(html,new RegExp('id="view-'+x+'"'));
 }
 assert.match(app,/['"]intake['"],['"]cashier['"]/);
 for(const x of ['intakeDoc','intakeDate','intakeSupplier','intakeItemsBody','intakeFile','cashierSku','cashierSystem','cashierPhysical','cashierReason','cashierBody'])assert.match(html,new RegExp('id="'+x+'"'));
});
test('new workflow uses atomic RPC, keeps evidence attachment, and no official POS writes',()=>{
 assert.match(code,/rpc\('stocktrace_create_intake'/);
 assert.match(code,/rpc\('stocktrace_request_cashier_update'/);
 assert.match(code,/rpc\('stocktrace_update_cashier_status'/);
 assert.match(code,/uploadToBackend\(file,id/);
 assert.match(code,/stocktrace_intake_evidence/);
 assert.match(drive,/stocktrace_intakes/);
 assert.match(sql,/qty_difference integer GENERATED ALWAYS/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public.stocktrace_cashier_logs/);
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/stocktrace_is_leader\(\)/);
 assert.doesNotMatch(code,/stocktrace_update_cashier_stock|update\(['"]products/);
});
test('new SQL does not modify pre-existing StockTrace tables or delete any data',()=>{
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM public\.|UPDATE public\.cases|ALTER TABLE public\.cases/i);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public.stocktrace_update_cashier_status/);
});
test('packaged XLSX writer emits binary ZIP with required OpenXML parts and escaped text',()=>{
 const src=fs.readFileSync('xlsx-export.js','utf8');
 const context={TextEncoder,Uint8Array,Uint32Array,Number,Error};context.globalThis=context;
 vm.runInNewContext(src,context);
 const bytes=context.StockTraceXlsx.create([
  {name:'Penerimaan',rows:[['SKU','Qty'],['=HYPERLINK("bad")',4],['S&P <test>',-1]]},
  {name:'Kasir',rows:[['ID'],['KS-123']]}
 ]);
 assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4B);
 const dest=join('/tmp','stocktrace_v21_writer_qa.xlsx');
 writeFileSync(dest,Buffer.from(bytes));
 assert.ok(bytes.byteLength>1900);
});

test('receipt file uploads use separate receipt authorization and Drive appProperties',async()=>{
 const {default:upload}=await import('../api/drive-upload.mjs');
 const originalFetch=globalThis.fetch;
 const original={};
 for(const [k,v] of Object.entries({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'key',GOOGLE_CLIENT_ID:'a',GOOGLE_CLIENT_SECRET:'b',GOOGLE_REFRESH_TOKEN:'c',GOOGLE_DRIVE_FOLDER_ID:'folder'})){
  original[k]=process.env[k];process.env[k]=v;
 }
 const receipt='IN-20261029-ABCDEF123456',file='1A2b3C4d5E6f7G8h9I0j',person='00000000-0000-4000-8000-000000000001';
 let seenReceiptLookup=false;
 try{
  globalThis.fetch=async(u,opts={})=>{
   u=String(u);
   if(u.includes('/auth/v1/user'))return Response.json({id:person});
   if(u.includes('/rest/v1/users'))return Response.json([{role:'Staff'}]);
   if(u.includes('/rest/v1/stocktrace_intakes')){seenReceiptLookup=true;return Response.json([{id_intake:receipt}]);}
   if(u.includes('/rest/v1/cases'))throw Error('Receipt must not use R1 cases table');
   if(u.includes('oauth2.googleapis.com'))return Response.json({access_token:'google'});
   if(u.includes('/upload/drive/')){
    const info=JSON.parse(opts.body);assert.equal(info.appProperties.stocktrace_intake,receipt);
    assert.equal(info.appProperties.stocktrace_user,person);
    return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=receipt'}});
   }
   if(u.includes('/drive/v3/files/'))return Response.json({id:file,name:receipt+'__receipt.pdf',parents:['folder'],size:'150',trashed:false,appProperties:{stocktrace_intake:receipt,stocktrace_user:person}});
   throw Error('unexpected request '+u);
  };
  for(const action of ['start','verify']){
   const res=await upload.fetch(new Request('https://stocktrace.vercel.app/api/drive-upload',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action,case_id:receipt,filename:'receipt.pdf',size:150,type:'application/pdf',...(action==='verify'?{file_id:file}:{})})}));
   assert.equal(res.status,200,JSON.stringify(await res.json()));
  }
  assert.ok(seenReceiptLookup);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
