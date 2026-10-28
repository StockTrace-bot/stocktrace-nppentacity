// Download file by authenticated user; Supabase RLS enforces case visibility.
const fail=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
const vars=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'];
async function googleAccessToken(){
 const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.access_token)throw Error('Google OAuth gagal (cek refresh token).');
 return data.access_token;
}
export default {async fetch(request){
 if(request.method!=='GET')return fail('Gunakan GET.',405);
 if(vars.some(x=>!process.env[x]))return fail('Konfigurasi server tidak lengkap.',503);
 const url=new URL(request.url),caseId=url.searchParams.get('case_id')||'',fileId=url.searchParams.get('file_id')||'';
 if(!/^ST-[A-Za-z0-9_-]{5,45}$/.test(caseId)||!/^[A-Za-z0-9_-]{10,128}$/.test(fileId))return fail('ID tidak valid.',400);
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return fail('Login diperlukan.',401);
 try{
  const origin=process.env.SUPABASE_URL.replace(/\/+$/,'');
  const headers={apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`};
  const userRes=await fetch(origin+'/auth/v1/user',{headers});
  if(!userRes.ok)return fail('Sesi tidak valid.',401);
  const user=await userRes.json().catch(()=>({}));if(!user.id)return fail('Pengguna tidak dikenal.',401);
  const q=origin+'/rest/v1/evidence_files?select=nama_file_asli,drive_file_id&id_kasus=eq.'+encodeURIComponent(caseId)+'&drive_file_id=eq.'+encodeURIComponent(fileId)+'&limit=1';
  const metaRes=await fetch(q,{headers});if(!metaRes.ok)return fail('Hak akses metadata ditolak.',403);
  const rows=await metaRes.json().catch(()=>[]);if(!Array.isArray(rows)||rows.length!==1)return fail('Bukti tidak ditemukan atau tidak diizinkan.',404);
  const t=await googleAccessToken();
  const response=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media',{headers:{Authorization:`Bearer ${t}`}});
  if(!response.ok)return fail('Google Drive tidak dapat mengembalikan berkas.',502);
  const max=4*1024*1024,sz=Number(response.headers.get('content-length')||'0');if(sz>max)return fail('Berkas terlalu besar untuk proxy.',413);
  const data=await response.arrayBuffer();if(data.byteLength>max)return fail('Berkas terlalu besar untuk proxy.',413);
  const name=String(rows[0].nama_file_asli||'bukti').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').slice(0,110);
  return new Response(data,{status:200,headers:{'Content-Type':response.headers.get('content-type')||'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){console.error('StockTrace evidence download:',error.message);return fail('Pengunduhan gagal. Periksa Vercel Logs.',502);}
}};
