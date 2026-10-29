// ID-only UI authentication through Supabase email/password behind server boundary.
// Email address is never accepted as user input or sent to unauthenticated browsers.
// Requires SUPABASE_SERVICE_ROLE_KEY and SQL 05 migration/rate gate.
const json=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const deny=(status=401)=>json({error:status===429?'Terlalu banyak percobaan. Coba kembali nanti.':'ID Pengguna atau kata sandi tidak cocok.'},status);
const ID_RE=/^NP-(?:STF|LDR)-\d{3}$/;
export default {async fetch(req){
 if(req.method!=='POST')return json({error:'Gunakan POST.'},405);
 if(!['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'].every(x=>process.env[x]))return json({error:'Login ID belum diaktifkan oleh administrator.'},503);
 // Reject cross-site requests; sessions are obtained only by the first-party login form.
 const origin=req.headers.get('origin');
 if(origin&&origin!==new URL(req.url).origin)return deny(403);
 if(Number(req.headers.get('content-length')||'0')>1024)return deny(413);
 try{
  if(!(req.headers.get('content-type')||'').includes('application/json'))return deny(415);
  const body=await req.json();const id=String(body.login_id||'').trim().toUpperCase();const password=body.password;
  if(!ID_RE.test(id)||typeof password!=='string'||password.length<1||password.length>256)return deny();
  const base=process.env.SUPABASE_URL.replace(/\/+$/,'');
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin={apikey:secret,Authorization:`Bearer ${secret}`};
  // Durable atomic rate gate, not Vercel in-memory state; deny closed if the gate is unavailable.
  const gate=await fetch(base+'/rest/v1/rpc/stocktrace_login_gate',{method:'POST',headers:{...admin,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:id})});
  if(!gate.ok){console.error('login_gate unavailable',gate.status);return json({error:'Login sementara belum tersedia. Hubungi administrator.'},503);}
  if((await gate.json())!==true)return deny(429);
  const map=await fetch(base+'/rest/v1/users?select=id_user&login_id=eq.'+encodeURIComponent(id)+'&limit=1',{headers:admin});
  if(!map.ok)return deny();
  const rows=await map.json().catch(()=>[]);if(!Array.isArray(rows)||rows.length!==1)return deny();
  const uid=rows[0].id_user;
  // Fetch Auth email server-side; credentials never embedded in the JS/HTML bundle.
  const auth=await fetch(base+'/auth/v1/admin/users/'+encodeURIComponent(uid),{headers:admin});
  if(!auth.ok)return deny();const u=await auth.json();
  if(!u?.email||u.id!==uid)return deny();
  const res=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password})});
  if(!res.ok)return deny();const session=await res.json().catch(()=>({}));
  if(!session.access_token||!session.refresh_token||session.user?.id!==uid)return deny();
  return json({access_token:session.access_token,refresh_token:session.refresh_token,token_type:'bearer'});
 }catch(err){console.error('ID login error:',err?.message||'unexpected');return json({error:'Layanan login tidak tersedia. Coba lagi nanti.'},503);}
}};
