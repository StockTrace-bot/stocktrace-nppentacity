import test from 'node:test';
import assert from 'node:assert/strict';
import driveUpload from '../api/drive-upload.mjs';
import evidence from '../api/evidence.mjs';

const caseId='ST-261028-2fd18cf044ca';
const user='68e746eb-743a-4382-9310-c6c4bff983cd';
const fileId='1A2b3C4d5E6f7G8h9I0j';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='public-test';
process.env.GOOGLE_CLIENT_ID='client-test';
process.env.GOOGLE_CLIENT_SECRET='never-real';
process.env.GOOGLE_REFRESH_TOKEN='never-real';
process.env.GOOGLE_DRIVE_FOLDER_ID='folder-test';
const u='https://stocktrace-nppentacity.vercel.app/api/drive-upload';
const auth={'Content-Type':'application/json','Authorization':'Bearer test-token'};
const body=(action,add={})=>JSON.stringify({action,case_id:caseId,filename:'video.mp4',size:15*1024*1024,type:'video/mp4',...add});
const request=(action,add={},headers=auth)=>new Request(u,{method:'POST',headers,body:body(action,add)});
const originalFetch=globalThis.fetch;
function mock(handler){globalThis.fetch=async (url,init={})=>{
 const s=String(url);
 if(s.includes('/auth/v1/user'))return Response.json({id:user});
 if(s.includes('/rest/v1/users'))return Response.json([{role:'Staff'}]);
 if(s.includes('/rest/v1/cases'))return Response.json([{id_kasus:caseId}]);
 if(s.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'google-test'});
 return handler(s,init);
};}
test.afterEach(()=>globalThis.fetch=originalFetch);

test('reject missing user token',async()=>{
 const r=await driveUpload.fetch(request('start',{}, {'Content-Type':'application/json'}));
 assert.equal(r.status,401);
});
test('reject more than 100MiB',async()=>{
 mock(()=>{throw Error('unexpected google call');});
 const r=await driveUpload.fetch(request('start',{size:100*1024*1024+1}));
 assert.equal(r.status,413);
});
test('reject unknown case via RLS',async()=>{
 mock(()=>{throw Error('unexpected google call');});
 const r=await driveUpload.fetch(request('start',{case_id:'INVALID'}));
 assert.equal(r.status,400);
});
test('server starts authorized Drive session without media bytes',async()=>{
 mock((url,init)=>{
  assert.match(url,/uploadType=resumable/);
  assert.equal(init.headers['X-Upload-Content-Length'],String(15*1024*1024));
  const metadata=JSON.parse(init.body);
  assert.equal(metadata.appProperties.stocktrace_case,caseId);
  assert.equal(metadata.appProperties.stocktrace_user,user);
  assert.deepEqual(metadata.parents,['folder-test']);
  return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc'}});
 });
 const r=await driveUpload.fetch(request('start'));
 assert.equal(r.status,200);
 const j=await r.json();assert.equal(j.success,true);assert.match(j.session_url,/upload_id=abc/);
});
test('server verifies Drive file folder, case, uploader, size before accepting',async()=>{
 mock(()=>Response.json({id:fileId,name:`${caseId}__video.mp4`,size:String(15*1024*1024),parents:['folder-test'],trashed:false,appProperties:{stocktrace_case:caseId,stocktrace_user:user}}));
 const r=await driveUpload.fetch(request('verify',{file_id:fileId}));
 assert.equal(r.status,200);assert.equal((await r.json()).drive_file_id,fileId);
});
test('reject forged Drive file from different uploader or folder',async()=>{
 mock(()=>Response.json({id:fileId,name:`${caseId}__video.mp4`,size:String(15*1024*1024),parents:['other-folder'],appProperties:{stocktrace_case:caseId,stocktrace_user:'bad'}}));
 const r=await driveUpload.fetch(request('verify',{file_id:fileId}));
 assert.equal(r.status,403);
});
test('stream large authorized evidence response instead of buffer',async()=>{
 let last;
 mock((url)=>{
  if(url.includes('/rest/v1/evidence_files'))return Response.json([{nama_file_asli:'video.mp4',drive_file_id:fileId}]);
  if(url.includes('/drive/v3/files/')){
   last = new ReadableStream({start(ctrl){ctrl.enqueue(new Uint8Array([1,2,3]));ctrl.close();}});
   return new Response(last,{headers:{'content-type':'video/mp4','content-length':String(100*1024*1024)}});
  }
  throw Error('unknown url '+url);
 });
 const r=await evidence.fetch(new Request(`https://stocktrace-nppentacity.vercel.app/api/evidence?case_id=${caseId}&file_id=${fileId}`,{headers:{Authorization:'Bearer test'}}));
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(r.body,last);
});
