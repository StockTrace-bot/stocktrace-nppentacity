import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import reportApi from '../api/report-docx.mjs';
import { buildReportDocx } from '../api/_lib/report-docx.mjs';

const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('assets/app-bundle.js','utf8');
const sql=fs.readFileSync('sql/21_V43_SALES_OPERATOR_AND_REPORT_DOCS.sql','utf8');
const sheets=fs.readFileSync('api/sheets-sync.mjs','utf8');

function unzipLocalEntries(buffer){
 const entries=new Map();let offset=0;
 while(offset+30<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){
  const method=buffer.readUInt16LE(offset+8),compressedSize=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28);
  const name=buffer.subarray(offset+30,offset+30+nameLength).toString('utf8');
  const dataStart=offset+30+nameLength+extraLength,dataEnd=dataStart+compressedSize;
  const compressed=buffer.subarray(dataStart,dataEnd);
  entries.set(name,method===8?inflateRawSync(compressed).toString('utf8'):compressed.toString('utf8'));
  offset=dataEnd;
 }
 return entries;
}

test('V4.3 sales form separates selected sales from logged-in operator',()=>{
 assert.match(html,/id="retailSellerSelect"/);
 assert.match(html,/Dicatat oleh:/);
 assert.match(app,/function retailLoadSellerOptions\(\)/);
 assert.match(app,/staffDirectory\.filter\(u=>String\(u\.role\|\|''\)\.toLowerCase\(\)\.trim\(\)==='staff'/);
 assert.match(app,/p_seller:sellerId/);
 assert.match(app,/String\(existing\.data\.created_by\)!==String\(activeUser\.id\)/);
});

test('V4.3 scanner keeps the camera open for sales and intake and exposes supported camera controls',()=>{
 assert.match(html,/id="retailCameraZoom"/);
 assert.match(html,/id="retailCameraTorch"/);
 assert.match(app,/keepOpen=\['intake','sales'\]\.includes\(target\)/);
 assert.match(app,/retailCameraAccept\(codes\[0\]\.rawValue,gen\)/);
 assert.match(app,/retailCameraTrackReady\(stream\.getVideoTracks\(\)\[0\]\)/);
 assert.match(app,/retailSetCameraZoom/);
 assert.match(app,/retailToggleTorch/);
 assert.match(app,/decodeFromVideoElementContinuously/);
});

test('V4.3 Word report action is wired to the authenticated case detail',()=>{
 assert.match(html,/id="btnGenerateCaseWord"/);
 assert.match(html,/id="caseWordDocuments"/);
 assert.match(app,/fetch\('\/api\/report-docx'/);
 assert.match(app,/loadCaseWordDocuments\(id\)/);
 assert.match(app,/stocktrace_report_documents/);assert.match(app,/api\/report-download/);assert.match(app,/data-report-download/);assert.match(app,/await openCase\(id\);\s*await generateCaseWordReport\(\);/);
});

test('V4.3 migration separates seller/operator and preserves prior sales',()=>{
 assert.match(sql,/ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public\.users/);
 assert.match(sql,/UPDATE public\.st_sales SET created_by=seller WHERE created_by IS NULL/);
 assert.match(sql,/seller=auth\.uid\(\) OR created_by=auth\.uid\(\) OR public\.stocktrace_is_leader\(\)/);
 assert.match(sql,/st_record_sale\(\s*p_id uuid,p_receipt text,p_items jsonb,p_seller uuid\s*\)/);
 assert.match(sql,/INSERT INTO public\.st_sales\(id,receipt,seller,seller_name,created_by\)/);
 assert.match(sql,/s\.created_by<>auth\.uid\(\)/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.stocktrace_report_documents/);
 assert.match(sql,/UNIQUE\(case_id,version\)/);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('Google Sheets sales mapping includes operator attribution',()=>{
 assert.match(sheets,/columns:\['id','receipt','seller','seller_name','created_at','voided_at','voided_by','void_reason','created_by'/);
 assert.match(sheets,/ID Operator Pencatat/);
});

test('DOCX generator emits a valid OpenXML package and escapes report content',()=>{
 const docx=buildReportDocx({
  report:{id_kasus:'ST-261125-ABCDEF123456',sku_produk:'SKU-001',nama_produk:'Blouse <Hitam> & Putih',stok_sistem:8,stok_fisik:6,selisih:-2,dugaan_penyebab:'Belum diketahui',kronologi:'Pemeriksaan <rak> & kasir',status_kasus:'Dalam Pemeriksaan',created_at:'2026-11-25T03:00:00Z'},
  reporterName:'Staff & Leader',evidence:[{nama_file_asli:'foto bukti.jpg',drive_view_url:'https://drive.google.com/file/d/example/view'}],version:1
 });
 assert.equal(docx.subarray(0,2).toString(),'PK');
 const entries=unzipLocalEntries(docx);
 assert.ok(entries.has('[Content_Types].xml'));
 assert.ok(entries.has('word/document.xml'));
 assert.ok(entries.has('word/styles.xml'));
 const xml=entries.get('word/document.xml');
 assert.match(xml,/Blouse &lt;Hitam&gt; &amp; Putih/);
 assert.match(xml,/SKU-001/);
 assert.match(xml,/Stok Menurut Sistem/);assert.match(xml,/Tanggal laporan/);
 assert.match(xml,/Staff &amp; Leader/);
});

test('Word report API rejects requests without authentication',async()=>{
 const original={};
 for(const [k,v] of Object.entries({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-role-test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'refresh',GOOGLE_DRIVE_FOLDER_ID:'r1-folder-123456',GOOGLE_DRIVE_INTAKE_FOLDER_ID:'intake-folder-123456'})){original[k]=process.env[k];process.env[k]=v;}
 try{
  const response=await reportApi.fetch(new Request('https://staging.example/api/report-docx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case_id:'ST-261125-ABCDEF123456'})}));
  assert.equal(response.status,401);
 }finally{for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('Word report API validates the case, uploads DOCX to a managed Drive folder, and records metadata with service role',async()=>{
 const env={
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-role-test',
  GOOGLE_CLIENT_ID:'client-test',GOOGLE_CLIENT_SECRET:'secret-test',GOOGLE_REFRESH_TOKEN:'refresh-test',
  GOOGLE_DRIVE_FOLDER_ID:'r1-folder-123456',GOOGLE_DRIVE_INTAKE_FOLDER_ID:'intake-folder-123456'
 };
 const originalEnv={},originalFetch=globalThis.fetch;
 for(const [key,value] of Object.entries(env)){originalEnv[key]=process.env[key];process.env[key]=value;}
 const user='00000000-0000-4000-8000-000000000001',caseId='ST-261125-ABCDEF123456';
 let uploaded=false,inserted=false,uploadBodyLength=0;
 try{
  globalThis.fetch=async(url,options={})=>{
   const u=String(url),method=options.method||'GET';
   if(u.includes('/auth/v1/user'))return Response.json({id:user});
   if(u.includes('/rest/v1/users'))return Response.json([{role:'Staff',nama_lengkap:'Operator'}]);
   if(u.includes('/rest/v1/cases'))return Response.json([{id_kasus:caseId,id_pelapor:user,sku_produk:'SKU-001',nama_produk:'Blouse Hitam',stok_sistem:10,stok_fisik:8,selisih:-2,dugaan_penyebab:'Belum diketahui',kronologi:'Pemeriksaan rak dan kasir',status_kasus:'Baru Dilaporkan',created_at:'2026-11-25T03:00:00Z',pic_nama:null,source_intake_id:null,deleted_at:null}]);
   if(u.includes('/rest/v1/rpc/stocktrace_staff_directory'))return Response.json([{id_user:user,nama_lengkap:'Operator',role:'Staff'}]);
   if(u.includes('/rest/v1/evidence_files'))return Response.json([{nama_file_asli:'foto.jpg',drive_file_id:'evidence123456',drive_view_url:'https://drive.google.com/file/d/evidence123456/view'}]);
   if(u.includes('/rest/v1/case_logs'))return Response.json([]);
   if(u.includes('/rest/v1/stocktrace_report_documents')&&method==='GET')return Response.json([]);
   if(u.includes('/rest/v1/stocktrace_report_documents')&&method==='POST'){
    assert.equal(options.headers.apikey,'service-role-test');
    assert.equal(options.headers.Authorization,'Bearer service-role-test');
    const payload=JSON.parse(options.body);assert.equal(payload.case_id,caseId);assert.equal(payload.created_by,user);assert.equal(payload.version,1);inserted=true;
    return Response.json([{created_at:'2026-11-25T03:10:00Z'}]);
   }
   if(u.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'google-test',expires_in:3600});
   if(u.includes('/drive/v3/files/r1-folder-123456'))return Response.json({id:'r1-folder-123456',name:'R1',mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:true}});
   if(u.includes('/drive/v3/files?q='))return Response.json({files:[]});
   if(u.includes('/drive/v3/files?fields=')&&method==='POST'){
    const metadata=JSON.parse(options.body);assert.equal(metadata.appProperties.stocktrace_report_folder,'v1');
    return Response.json({id:'report-folder-123456',name:metadata.name,mimeType:'application/vnd.google-apps.folder',parents:['r1-folder-123456'],appProperties:metadata.appProperties});
   }
   if(u.includes('/upload/drive/v3/files?uploadType=multipart')){
    const body=Buffer.from(options.body);uploadBodyLength=body.length;assert.ok(body.subarray(0,2).toString()==='--');
    assert.ok(body.toString('latin1').includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    uploaded=true;
    return Response.json({id:'docx-file-123456',name:`Laporan_Selisih_Stok_${caseId}_v1.docx`,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:'2500',parents:['report-folder-123456'],appProperties:{stocktrace_report_case:caseId,stocktrace_report_version:'1',stocktrace_user:user},webViewLink:'https://drive.google.com/file/d/docx-file-123456/view'});
   }
   throw Error('Unexpected request '+u);
  };
  const response=await reportApi.fetch(new Request('https://staging.example/api/report-docx',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer user-token'},body:JSON.stringify({case_id:caseId})}));
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true);assert.equal(result.version,1);assert.equal(result.drive_file_id,'docx-file-123456');assert.ok(uploaded&&inserted&&uploadBodyLength>1000);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

import reportDownload from '../api/report-download.mjs';

test('Word report download streams only a document authorized by the user session',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',GOOGLE_CLIENT_ID:'client-test',GOOGLE_CLIENT_SECRET:'secret-test',GOOGLE_REFRESH_TOKEN:'refresh-test'};
 const originalEnv={},originalFetch=globalThis.fetch;for(const [key,value] of Object.entries(env)){originalEnv[key]=process.env[key];process.env[key]=value;}
 const caseId='ST-261125-ABCDEF123456',fileId='docx-file-123456',user='00000000-0000-4000-8000-000000000001';
 let stream;
 try{
  globalThis.fetch=async(url,options={})=>{
   const u=String(url);
   if(u.includes('/auth/v1/user'))return Response.json({id:user});
   if(u.includes('/rest/v1/stocktrace_report_documents'))return Response.json([{file_name:'Laporan_Selisih_Stok_v1.docx',drive_file_id:fileId}]);
   if(u.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'google-test',expires_in:3600});
   if(u.includes('/drive/v3/files/')){stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([80,75,3,4]));controller.close();}});return new Response(stream,{headers:{'content-type':'application/octet-stream'}});}
   throw Error('Unexpected request '+u);
  };
  const response=await reportDownload.fetch(new Request(`https://staging.example/api/report-download?case_id=${caseId}&file_id=${fileId}`,{headers:{Authorization:'Bearer user-token'}}));
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/Laporan_Selisih_Stok_v1\.docx/);assert.equal(response.body,stream);
 }finally{
  globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
