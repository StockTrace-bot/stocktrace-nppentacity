// StockTrace direct-to-Drive resumable uploads. JSON control messages only;
// no file data travels via Vercel. OAuth refresh token never goes to the browser.
const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set(['jpg','jpeg','png','pdf','mp4','webm','doc','docx','xls','xlsx','csv','txt']);
const ROLES = new Set(['staff','leader','admin','store leader','store_leader']);
const VARS = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID'];
const json = (data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,error,status)=>json({success:false,code,error},status);
const validCase=id=>/^ST-[A-Za-z0-9_-]{5,45}$/.test(id);
const validIntake=id=>/^IN-[0-9]{8}-[A-Z0-9]{12}$/.test(id);
const cleanName=name=>String(name||'').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').trim().slice(0,120);
const validFileId=id=>/^[A-Za-z0-9_-]{10,128}$/.test(id);
const validSize=n=>Number.isSafeInteger(n)&&n>0&&n<=MAX_BYTES;
const driveError=(message, status=502)=>Object.assign(new Error(message),{status});

async function authAndCase(req,caseId){
 const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)throw driveError('Login diperlukan.',401);
 const origin=process.env.SUPABASE_URL.replace(/\/+$/,'');
 const headers={apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`};
 const r=await fetch(origin+'/auth/v1/user',{headers});
 if(!r.ok)throw driveError('Sesi login tidak valid.',401);
 const user=await r.json();if(!user.id)throw driveError('Akun tidak dikenal.',401);
 const p=await fetch(origin+'/rest/v1/users?select=role&id_user=eq.'+encodeURIComponent(user.id)+'&limit=1',{headers});
 if(!p.ok)throw driveError('Profil tidak bisa diperiksa.',403);
 const roles=await p.json();if(!ROLES.has(String(roles?.[0]?.role||'').toLowerCase().trim()))throw driveError('Role tidak memiliki akses upload.',403);
 const isIntake=validIntake(caseId);
 if(!validCase(caseId)&&!isIntake)throw driveError('Format ID kasus/penerimaan tidak valid.',400);
 const table=isIntake?'stocktrace_intakes':'cases';
 const field=isIntake?'id_intake':'id_kasus';
 const c=await fetch(origin+'/rest/v1/'+table+'?select='+field+'&'+field+'=eq.'+encodeURIComponent(caseId)+'&limit=1',{headers});
 if(!c.ok)throw driveError('Hak akses dokumen ditolak.',403);
 const rows=await c.json();if(!Array.isArray(rows)||rows.length!==1)throw driveError('Dokumen tidak ditemukan atau tidak boleh diakses.',403);
 return {user,isIntake};
}
async function googleToken(){
 const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const v=await r.json().catch(()=>({}));
 if(!r.ok||!v.access_token)throw driveError('OAuth Google gagal; cek token di Vercel.');
 return v.access_token;
}
function fileInput(body){
 const filename=cleanName(body.filename),size=Number(body.size),type=String(body.type||'application/octet-stream').slice(0,120);
 const ext=filename.split('.').pop().toLowerCase();
 if(!filename||!ALLOWED.has(ext))throw driveError('Ekstensi berkas tidak diizinkan.',415);
 if(!validSize(size))throw driveError('Ukuran berkas harus 1 byte sampai 100 MiB.',413);
 if(!/^[\w.+-]+\/[\w.+-]+$/.test(type))throw driveError('MIME type tidak valid.',415);
 return {filename,size,type};
}
export default {async fetch(req){
 if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED','Gunakan POST.',405);
 const missing=VARS.filter(key=>!process.env[key]);
 if(missing.length)return fail('CONFIG_MISSING','Environment Variables belum lengkap: '+missing.join(', '),503);
 const length=Number(req.headers.get('content-length')||'0');
 if(length>8192)return fail('REQUEST_TOO_LARGE','Request kontrol terlalu besar.',413);
 if(!(req.headers.get('content-type')||'').includes('application/json'))return fail('INVALID_CONTENT_TYPE','Hanya JSON tanpa file.',415);
 try{
  const body=await req.json();
  const action=String(body.action||'');const caseId=String(body.case_id||'');
  const {user,isIntake}=await authAndCase(req,caseId);
  if(action==='start'){
   const {filename,size,type}=fileInput(body);
   const google=await googleToken();
   const metadata={name:`${caseId}__${filename}`,mimeType:type,parents:[process.env.GOOGLE_DRIVE_FOLDER_ID],description:`StockTrace — bukti ${isIntake?'penerimaan':'kasus'} ${caseId}`,
     appProperties:{[isIntake?'stocktrace_intake':'stocktrace_case']:caseId,stocktrace_user:user.id}};
   const api='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,parents,appProperties,webViewLink';
   // In browsers that depend on a matching Origin for CORS, carry the authenticated site's origin into initiation.
   const origin=new URL(req.url).origin;
   const r=await fetch(api,{method:'POST',headers:{Authorization:`Bearer ${google}`,'Content-Type':'application/json; charset=UTF-8',
       'X-Upload-Content-Type':type,'X-Upload-Content-Length':String(size),Origin:origin},body:JSON.stringify(metadata)});
   if(!r.ok){console.error('Drive session start',r.status);throw driveError('Google Drive gagal membuka sesi upload. Periksa Logs dan izin folder.');}
   const session=r.headers.get('location');
   if(!session||!session.startsWith('https://www.googleapis.com/upload/drive/'))throw driveError('Google tidak mengembalikan URL sesi yang valid.');
   return json({success:true,session_url:session,max_file_bytes:MAX_BYTES});
  }
  if(action==='verify'){
   const fileId=String(body.file_id||'');if(!validFileId(fileId))throw driveError('ID file tidak valid.',400);
   const expected=fileInput(body);
   const google=await googleToken();
   const fields='id,name,size,mimeType,parents,appProperties,trashed,webViewLink';
   const url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields='+encodeURIComponent(fields)+'&supportsAllDrives=true';
   const r=await fetch(url,{headers:{Authorization:`Bearer ${google}`}});
   if(!r.ok)throw driveError('Google Drive belum mengonfirmasi file. Jangan upload ulang sebelum mengecek Drive.');
   const data=await r.json();
   if(data.trashed||!data.parents?.includes(process.env.GOOGLE_DRIVE_FOLDER_ID)||
      data.appProperties?.[isIntake?'stocktrace_intake':'stocktrace_case']!==caseId||data.appProperties?.stocktrace_user!==user.id||
      data.name!==`${caseId}__${expected.filename}`||Number(data.size)!==expected.size){
      throw driveError('Metadata bukti tidak cocok dengan sesi upload yang diizinkan.',403);
   }
   return json({success:true,drive_file_id:data.id,
     drive_link:data.webViewLink||`https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`});
  }
  return fail('INVALID_ACTION','Gunakan action start atau verify.',400);
 }catch(err){
  const status=err.status||500;
  console.error('StockTrace drive-upload',status,err.message);
  return fail('DRIVE_UPLOAD_ERROR',status===500?'Server gagal memproses upload. Periksa Vercel Logs.':err.message,status);
 }
}};
