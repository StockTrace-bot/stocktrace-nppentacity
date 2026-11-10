// Download file by authenticated user; Supabase RLS enforces case visibility.
import { getGoogleOAuthConfig, getSupabaseConfig } from './_lib/stocktrace-config.mjs';
const fail=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
function requiredConfigMissing(){const s=getSupabaseConfig(),g=getGoogleOAuthConfig();return [...(!s.url?['SUPABASE_URL']:[]),...(!s.publishableKey?['SUPABASE_PUBLISHABLE_KEY']:[]),...(!g.clientId?['GOOGLE_CLIENT_ID']:[]),...(!g.clientSecret?['GOOGLE_CLIENT_SECRET']:[]),...(!g.refreshToken?['GOOGLE_REFRESH_TOKEN']:[])];}
async function googleAccessToken(){
 const g=getGoogleOAuthConfig();const body=new URLSearchParams({client_id:g.clientId,client_secret:g.clientSecret,refresh_token:g.refreshToken,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.access_token)throw Error('Google OAuth gagal (cek refresh token).');
 return data.access_token;
}
export default {async fetch(request){
 if(request.method!=='GET')return fail('Gunakan GET.',405);
 const missing=requiredConfigMissing();if(missing.length)return fail('Konfigurasi server tidak lengkap: '+missing.join(', '),503);
 const url=new URL(request.url),caseId=url.searchParams.get('case_id')||'',fileId=url.searchParams.get('file_id')||'';
 const isIntake=/^IN-[0-9]{8}-[A-Z0-9]{12}$/.test(caseId);
 if(!(/^ST-[A-Za-z0-9_-]{5,45}$/.test(caseId)||isIntake)||!/^[A-Za-z0-9_-]{10,128}$/.test(fileId))return fail('ID tidak valid.',400);
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return fail('Login diperlukan.',401);
 try{
  const supabase=getSupabaseConfig();const origin=supabase.url;
  const headers={apikey:supabase.publishableKey,Authorization:`Bearer ${token}`};
  const userRes=await fetch(origin+'/auth/v1/user',{headers});
  if(!userRes.ok)return fail('Sesi tidak valid.',401);
  const user=await userRes.json().catch(()=>({}));if(!user.id)return fail('Pengguna tidak dikenal.',401);
  const table=isIntake?'stocktrace_intake_evidence':'evidence_files';
  const fk=isIntake?'id_intake':'id_kasus';
  const q=origin+'/rest/v1/'+table+'?select=nama_file_asli,drive_file_id&'+fk+'=eq.'+encodeURIComponent(caseId)+'&drive_file_id=eq.'+encodeURIComponent(fileId)+'&limit=1';
  const metaRes=await fetch(q,{headers});if(!metaRes.ok)return fail('Hak akses metadata ditolak.',403);
  const rows=await metaRes.json().catch(()=>[]);if(!Array.isArray(rows)||rows.length!==1)return fail('Bukti tidak ditemukan atau tidak diizinkan.',404);
  const t=await googleAccessToken();
  const response=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media',{headers:{Authorization:`Bearer ${t}`}});
  if(!response.ok)return fail('Google Drive tidak dapat mengembalikan berkas.',502);
  // Stream the authorized Drive response; do not buffer large videos in Vercel memory.
  // If Vercel streaming is disabled/incompatible, test large downloads in staging.
  const name=String(rows[0].nama_file_asli||'bukti').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').slice(0,110);
  return new Response(response.body,{status:200,headers:{
    'Content-Type':response.headers.get('content-type')||'application/octet-stream',
    'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  }});
 }catch(error){console.error('StockTrace evidence download:',error.message);return fail('Pengunduhan gagal. Periksa Vercel Logs.',502);}
}};
