/* StockTrace → Google Sheets (near-real-time Supabase Database Webhook + leader full resync).
 * Secrets stay on Vercel. Never place service-account JSON in this source.
 * This endpoint reads only Staff/Leader-visible data for manual full resync.
 */
import { google } from 'googleapis';
import { timingSafeEqual } from 'node:crypto';

const SHEETS = {
  cases: {
    tab: 'Kasus', key: 'id_kasus',
    columns: ['id_kasus','id_pelapor','sku_produk','nama_produk','stok_sistem','stok_fisik','selisih','dugaan_penyebab','kronologi','status_kasus','created_at'],
    labels: ['ID Kasus','ID Pelapor','SKU Produk','Nama Produk','Stok Sistem','Stok Fisik','Selisih','Dugaan Penyebab','Kronologi','Status Kasus','Dibuat Pada']
  },
  evidence_files: {
    tab: 'Bukti', key: 'id_file',
    columns: ['id_file','id_kasus','nama_file_asli','drive_file_id','drive_view_url','waktu_unggah'],
    labels: ['ID Bukti','ID Kasus','Nama Berkas','Google Drive File ID','Google Drive URL','Waktu Unggah']
  },
  case_logs: {
    tab: 'Riwayat', key: 'id_log',
    columns: ['id_log','id_kasus','id_user','aksi','catatan','waktu_aksi'],
    labels: ['ID Log','ID Kasus','ID Pengguna','Aksi','Catatan','Waktu Aksi']
  }
};
const FULL_SYNC_LEADER_ROLES=new Set(['leader','admin','store leader','store_leader']);
const ENV_NAMES=['GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON','GOOGLE_SHEETS_SPREADSHEET_ID','STOCKTRACE_SHEETS_WEBHOOK_SECRET','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];
const MAX_BODY_BYTES=512*1024;
function json(payload,status=200){return Response.json(payload,{status,headers:{'Cache-Control':'no-store'}});}
function fail(status,code,message){return json({ok:false,code,message},status);}
function constantTimeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
  const x=Buffer.from(a,'utf8'),y=Buffer.from(b,'utf8');
  return x.length===y.length && timingSafeEqual(x,y);
}
function a1(tab,range){return `'${tab.replaceAll("'","''")}'!${range}`;}
function googleValue(x){
  if(x===null||x===undefined)return '';
  if(typeof x==='number'||typeof x==='boolean')return x;
  return String(x); // valueInputOption: RAW prevents formula evaluation.
}
// Convert UTC timestamps from Supabase to readable Balikpapan local time.
// Google Sheets stores this as readable text; Supabase retains original UTC values.
const TIMESTAMP_COLUMNS = new Set(['created_at','waktu_unggah','waktu_aksi']);
const WITA_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Makassar',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});
function formatWitaTimestamp(value){
  if(value === null || value === undefined || value === '')return '';
  const parsed = new Date(value);
  if(Number.isNaN(parsed.getTime()))return String(value);
  const parts = Object.fromEntries(WITA_FORMATTER.formatToParts(parsed)
    .filter(item => item.type !== 'literal')
    .map(item => [item.type, item.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} WITA`;
}
function encodeRow(rec,schema){
  return schema.columns.map(k => TIMESTAMP_COLUMNS.has(k)
    ? formatWitaTimestamp(rec[k]) : googleValue(rec[k]));
}
function colLetter(n){let result='';while(n>0){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}return result;}
function getClient(){
  let credentials;
  try{credentials=JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON||'');}
  catch{throw Object.assign(new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON bukan JSON valid.'),{code:'GOOGLE_CREDENTIALS_BAD_JSON',status:503});}
  if(credentials?.type!=='service_account'||!credentials.private_key||!credentials.client_email)
    throw Object.assign(new Error('JSON Service Account tidak memuat type, private_key, atau client_email.'),{code:'GOOGLE_CREDENTIALS_INCOMPLETE',status:503});
  const auth=new google.auth.GoogleAuth({
    credentials,
    scopes:['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({version:'v4',auth});
}
async function ensureHeader(client,sid,schema){
  const range=a1(schema.tab,`A1:${colLetter(schema.columns.length)}1`);
  const response=await client.spreadsheets.values.get({spreadsheetId:sid,range});
  const current=response.data.values?.[0]||[];
  if(!current.length){
    await client.spreadsheets.values.update({spreadsheetId:sid,range,valueInputOption:'RAW',requestBody:{values:[schema.labels]}});
  }else if(schema.labels.some((label,i)=>current[i]!==label)){
    throw Object.assign(new Error(`Header tab ${schema.tab} tidak sama dengan StockTrace. Jalankan sinkronisasi penuh dari akun Leader terlebih dahulu.`),{code:'SHEET_HEADER_MISMATCH',status:409});
  }
}
async function upsertOne(client,sid,schema,record){
  const id=String(record?.[schema.key]||'');
  if(!id||id.length>160)throw Object.assign(new Error('ID record tidak valid.'),{status:400,code:'RECORD_ID_INVALID'});
  await ensureHeader(client,sid,schema);
  const keyRange=a1(schema.tab,'A2:A');
  const ids=(await client.spreadsheets.values.get({spreadsheetId:sid,range:keyRange})).data.values||[];
  const rowNumber=ids.findIndex(r=>String(r[0]||'')===id);
  const fullEnd=colLetter(schema.columns.length);
  const values=[encodeRow(record,schema)];
  if(rowNumber!==-1){
    const row=rowNumber+2;
    await client.spreadsheets.values.update({spreadsheetId:sid,range:a1(schema.tab,`A${row}:${fullEnd}${row}`),valueInputOption:'RAW',requestBody:{values}});
    return 'updated';
  }
  await client.spreadsheets.values.append({spreadsheetId:sid,range:a1(schema.tab,`A:${fullEnd}`),valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values}});
  return 'inserted';
}
async function deleteOne(client,sid,schema,record){
  const id=String(record?.[schema.key]||'');
  if(!id)return 'ignored';
  await ensureHeader(client,sid,schema);
  const ids=(await client.spreadsheets.values.get({spreadsheetId:sid,range:a1(schema.tab,'A2:A')})).data.values||[];
  const index=ids.findIndex(r=>String(r[0]||'')===id);
  if(index===-1)return 'already-absent';
  const sheetResponse=await client.spreadsheets.get({spreadsheetId:sid,fields:'sheets(properties(sheetId,title))'});
  const sheetId=sheetResponse.data.sheets?.find(s=>s.properties?.title===schema.tab)?.properties?.sheetId;
  if(!Number.isInteger(sheetId))throw Object.assign(new Error(`Tab ${schema.tab} belum tersedia.`),{status:409,code:'SHEET_NOT_FOUND'});
  await client.spreadsheets.batchUpdate({spreadsheetId:sid,requestBody:{requests:[{deleteDimension:{range:{sheetId,dimension:'ROWS',startIndex:index+1,endIndex:index+2}}}]}});
  return 'deleted';
}
async function findLeader(request){
  const bearer=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!bearer)return null;
  const origin=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const headers={apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${bearer}`};
  const response=await fetch(`${origin}/auth/v1/user`,{headers});
  if(!response.ok)return null;
  const user=await response.json();
  if(!user?.id)return null;
  const profile=await fetch(`${origin}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`,{headers});
  if(!profile.ok)return null;
  const roles=await profile.json();
  if(!FULL_SYNC_LEADER_ROLES.has(String(roles?.[0]?.role||'').toLowerCase().trim()))return null;
  return {headers,origin};
}
async function fetchAllRows(identity,table){
  // Backend uses the authenticated leader's RLS, NOT a Supabase service-role key.
  const all=[];const pageSize=500;const maxRows=5000;
  for(let offset=0;offset<=maxRows;offset+=pageSize){
    const params=new URLSearchParams({select:'*',limit:String(pageSize),offset:String(offset)});
    const resp=await fetch(`${identity.origin}/rest/v1/${table}?${params}`,{headers:identity.headers});
    if(!resp.ok)throw Object.assign(new Error(`Tidak bisa membaca ${table} dari Supabase (HTTP ${resp.status}).`),{status:502,code:'SUPABASE_READ_FAILED'});
    const page=await resp.json();
    if(!Array.isArray(page))throw Object.assign(new Error(`Format data ${table} tidak sesuai.`),{status:502,code:'SUPABASE_BAD_RESPONSE'});
    if(offset===maxRows&&page.length)throw Object.assign(new Error('Jumlah data melebihi batas sinkronisasi 5000 baris per tabel. Hubungi pengelola aplikasi.'),{status:413,code:'SYNC_LIMIT'});
    all.push(...page);
    if(page.length<pageSize)break;
  }
  // Stable order so a re-sync produces deterministic rows.
  const key=SHEETS[table].key;
  all.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||'')));
  return all;
}
async function fullSync(client,sid,identity){
  const datasets={};
  for(const table of Object.keys(SHEETS))datasets[table]=await fetchAllRows(identity,table);
  // Abort early if any expected tab is missing; don't accidentally create a new tab.
  const metadata=await client.spreadsheets.get({spreadsheetId:sid,fields:'sheets(properties(title))'});
  const names=new Set((metadata.data.sheets||[]).map(s=>s.properties?.title));
  for(const config of Object.values(SHEETS)){
    if(!names.has(config.tab))throw Object.assign(new Error(`Buat tab Google Sheets bernama ${config.tab} terlebih dahulu.`),{status:409,code:'SHEET_NOT_FOUND'});
  }
  const ranges=Object.values(SHEETS).map(c=>a1(c.tab,'A:Z'));
  await client.spreadsheets.values.batchClear({spreadsheetId:sid,requestBody:{ranges}});
  const data=Object.entries(SHEETS).map(([table,c])=>({
    range:a1(c.tab,`A1:${colLetter(c.columns.length)}${datasets[table].length+1}`),
    values:[c.labels,...datasets[table].map(r=>encodeRow(r,c))]
  }));
  await client.spreadsheets.values.batchUpdate({spreadsheetId:sid,requestBody:{valueInputOption:'RAW',data}});
  return Object.fromEntries(Object.entries(datasets).map(([name,rows])=>[name,rows.length]));
}
export default {
  async fetch(request){
    if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','POST only. This endpoint is not a public report.');
    if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES)return fail(413,'TOO_LARGE','Body terlalu besar.');
    try{
      const missing=ENV_NAMES.filter(key=>!process.env[key]);
      if(missing.length)return fail(503,'CONFIG_MISSING',`Pengaturan server belum lengkap: ${missing.join(', ')}.`);
      let body;
      try{body=await request.json();}catch{return fail(400,'BAD_JSON','Body harus JSON valid.');}
      const secret=request.headers.get('x-stocktrace-sync-secret')||'';
      const webhook=constantTimeEqual(secret,process.env.STOCKTRACE_SHEETS_WEBHOOK_SECRET);
      if(webhook){
        if(body?.schema!=='public'||!SHEETS[body.table]||!['INSERT','UPDATE','DELETE'].includes(body.type))
          return fail(400,'EVENT_INVALID','Event webhook tidak dikenali.');
        const record=body.type==='DELETE'?body.old_record:body.record;
        if(!record||typeof record!=='object')return fail(400,'RECORD_INVALID','Record webhook kosong.');
        const client=getClient(),sid=process.env.GOOGLE_SHEETS_SPREADSHEET_ID,schema=SHEETS[body.table];
        const action=body.type==='DELETE'?await deleteOne(client,sid,schema,record):await upsertOne(client,sid,schema,record);
        return json({ok:true,kind:'webhook',table:body.table,action});
      }
      // Backfill / repair all three tabs: requires an authenticated Leader/Admin token.
      if(body?.mode!=='full')return fail(401,'UNAUTHORIZED','Akses hanya untuk webhook terotorisasi atau Leader.');
      const identity=await findLeader(request);
      if(!identity)return fail(403,'LEADER_REQUIRED','Hanya akun Leader/Admin aktif yang dapat sinkronisasi penuh.');
      const client=getClient(),counts=await fullSync(client,process.env.GOOGLE_SHEETS_SPREADSHEET_ID,identity);
      return json({ok:true,kind:'full',counts});
    }catch(err){
      const status=err.status&&[400,401,403,409,413,502,503].includes(err.status)?err.status:502;
      const code=err.code||'SYNC_FAILED';
      // Google SDK errors sometimes include private details. Do NOT reflect them to the caller.
      console.error('StockTrace Sheets Sync gagal:',code,err?.response?.status||err?.status||'unknown',err.message);
      return fail(status,code,
        status===502?'Gagal sinkronisasi Google Sheets atau Supabase. Periksa Vercel Logs dan izin Editor Service Account.':err.message);
    }
  }
};
