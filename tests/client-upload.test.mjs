import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
const start=src.indexOf('// Upload larger media directly browser');
const end=src.indexOf('async function uploadFiles(',start);
assert(start>0&&end>start);
const code=src.slice(start,end)+'\nglobalThis.testUpload=uploadToBackend;';
const caseId='ST-261028-2fd18cf044ca',googleFile='F1234567890ABCdef_';
const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test';
const file=new Blob([new Uint8Array(18*1024*1024)],{type:'video/mp4'});Object.defineProperty(file,'name',{value:'unboxing.mp4'});

test('18MiB file goes through Google direct chunks, never Vercel file body',async()=>{
 const seen=[];const progress=[];
 const fetch=async(url,init)=>{
  if(url==='/api/drive-upload'){
   assert.equal(init.headers['Content-Type'],'application/json');
   const body=JSON.parse(init.body);assert.equal(body.size,file.size);
   if(body.action==='start')return Response.json({success:true,session_url:session});
   if(body.action==='verify')return Response.json({success:true,drive_file_id:googleFile,drive_link:'https://drive.google.com/file/d/'+googleFile+'/view'});
   throw Error('invalid action');
  }
  assert.equal(url,session);assert.equal(init.method,'PUT');
  seen.push({contentRange:init.headers['Content-Range'],size:init.body.size});
  if(seen.length===1)return new Response(null,{status:308,headers:{Range:'bytes=0-8388607'}});
  if(seen.length===2)return new Response(null,{status:308,headers:{Range:'bytes=0-16777215'}});
  return Response.json({id:googleFile});
 };
 const ctx=vm.createContext({fetch,location:{protocol:'https:'},Blob,URL,Response,Promise,Number,console,setTimeout});
 vm.runInContext(code,ctx);
 const result=await ctx.testUpload(file,caseId,'supabase-test',p=>progress.push(p));
 assert.equal(result.drive_file_id,googleFile);
 assert.equal(seen.length,3);
 assert.equal(seen[0].contentRange,`bytes 0-8388607/${file.size}`);
 assert.equal(seen[1].contentRange,`bytes 8388608-16777215/${file.size}`);
 assert.equal(seen[2].contentRange,`bytes 16777216-${file.size-1}/${file.size}`);
 assert.deepEqual(progress,[44,88,100]);
});
test('CORS/network error fails closed without falling back to Vercel multipart',async()=>{
 const fetch=async(url,init)=>{
  if(url==='/api/drive-upload')return Response.json({success:true,session_url:session});
  throw new TypeError('Failed to fetch');
 };
 const ctx=vm.createContext({fetch,location:{protocol:'https:'},Blob,URL,Response,Promise,Number,console,setTimeout});
 vm.runInContext(code,ctx);
 const small=new Blob([new Uint8Array(15)],{type:'video/mp4'});Object.defineProperty(small,'name',{value:'small.mp4'});
 await assert.rejects(ctx.testUpload(small,caseId,'token'),/Upload langsung ke Drive terputus|Tidak dapat memastikan posisi upload/);
});
