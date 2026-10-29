// StockTrace V2 Account Security. Only self-change, no public administrative reset.
// Server controls old-password proof and flags; service-role key stays in Vercel.
const NO_STORE={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers:NO_STORE});
const denied=(status=401)=>reply({error:status===429?'Terlalu banyak percobaan, coba nanti.':'Akses ditolak atau kata sandi tidak sesuai.'},status);
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEY'];
const emailPattern=/^[^\s@]+@[^\s@]+$/;
export default {async fetch(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method tidak didukung.'},405);
 if(required.some(k=>!process.env[k]))return reply({error:'Keamanan akun belum dikonfigurasi.'},503);
 if(req.method==='POST'){
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return denied(403);
  if(Number(req.headers.get('content-length')||'0')>2048)return denied(413);
  if(!(req.headers.get('content-type')||'').includes('application/json'))return denied(415);
 }
 const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return denied();
 const root=process.env.SUPABASE_URL.replace(/\/+$/,'');
 const adm={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`};
 try{
  const r=await fetch(root+'/auth/v1/user',{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}});
  if(!r.ok)return denied();const user=await r.json();if(!/^[0-9a-f-]{36}$/i.test(user?.id||''))return denied();
  const secUrl=root+'/rest/v1/stocktrace_account_security?id_user=eq.'+encodeURIComponent(user.id);
  const stateRes=await fetch(secUrl+'&select=must_change_password,last_password_change_at',{headers:adm});
  if(!stateRes.ok)return reply({error:'Migrasi Keamanan Akun belum siap.'},503);
  const rows=await stateRes.json();if(!Array.isArray(rows)||rows.length!==1)return reply({error:'Status akun belum disiapkan oleh administrator.'},503);
  if(req.method==='GET')return reply({must_change_password:rows[0].must_change_password,last_password_change_at:rows[0].last_password_change_at});
  const body=await req.json();const current=body.current_password,next=body.new_password;
  if(typeof current!=='string'||current.length<1||current.length>256||typeof next!=='string'||next.length<12||next.length>128||current===next)return reply({error:'Kata sandi baru harus berbeda dan terdiri dari 12–128 karakter.'},400);
  const limit=await fetch(root+'/rest/v1/rpc/stocktrace_password_gate',{method:'POST',headers:{...adm,'Content-Type':'application/json'},body:JSON.stringify({p_user_id:user.id})});
  if(!limit.ok)return reply({error:'Pembatas percobaan password belum tersedia.'},503);
  if(await limit.json()!==true)return denied(429);
  // Admin user lookup is server-side only. No email sent to the client.
  const u=await fetch(root+'/auth/v1/admin/users/'+encodeURIComponent(user.id),{headers:adm});
  if(!u.ok)return denied();const data=await u.json();const email=data?.email;
  if(!emailPattern.test(email||''))return reply({error:'Identitas internal belum siap.'},503);
  const check=await fetch(root+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:current})});
  if(!check.ok)return denied();const signed=await check.json().catch(()=>({}));if(signed.user?.id!==user.id)return denied();
  // Only after successfully authenticating the current password may the server update it.
  const update=await fetch(root+'/auth/v1/admin/users/'+encodeURIComponent(user.id),{method:'PUT',headers:{...adm,'Content-Type':'application/json'},body:JSON.stringify({password:next})});
  if(!update.ok)return reply({error:'Penggantian kata sandi gagal. Hubungi administrator.'},502);
  const release=await fetch(secUrl,{method:'PATCH',headers:{...adm,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({must_change_password:false,last_password_change_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
  if(!release.ok)return reply({error:'Kata sandi sudah diganti, tetapi status keamanan belum sinkron. Hubungi administrator tanpa membagikan password.'},502);
  return reply({ok:true});
 }catch(err){console.error('StockTrace account security',err?.message||'error');return reply({error:'Layanan keamanan akun belum tersedia.'},503);}
}};
