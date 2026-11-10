// Browser may read only these two PUBLIC settings. No service key or Google token.
import { getSupabaseConfig } from './_lib/stocktrace-config.mjs';
const KNOWN_PRODUCTION='https://tcwkfsrxjujsuyttxgfz.supabase.co';
export default {async fetch(req){
 if(req.method!=='GET')return Response.json({error:'GET only'},{status:405});
 const supabase=getSupabaseConfig();
 const url=supabase.url;
 const key=supabase.publishableKey;
 if(!url||!key||!/^https:\/\/[^/]+\.supabase\.co$/.test(url))return Response.json({error:'Supabase public config belum lengkap.'},{status:503,headers:{'Cache-Control':'no-store'}});
 if(process.env.VERCEL_ENV==='preview'&&url===KNOWN_PRODUCTION)return Response.json({error:'Preview diblokir: backend masih Supabase produksi. Atur Environment Variables Preview ke proyek staging.'},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({supabase_url:url,supabase_publishable_key:key},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}};
