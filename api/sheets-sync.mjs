/* StockTrace → Google Sheets.
 * R1 tables keep using GOOGLE_SHEETS_SPREADSHEET_ID.
 * V2.1 intake/cashier tables use GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID.
 * Secrets stay on Vercel. Never place service-account JSON in this source.
 * Manual full resync reads only data visible to the authenticated Leader through RLS.
 */
import { google } from 'googleapis';
import { timingSafeEqual } from 'node:crypto';

const SHEETS = {
  cases: {
    tab: 'Kasus', key: 'id_kasus', sortTimeKey: 'created_at',
    columns: ['id_kasus','id_pelapor','sku_produk','nama_produk','stok_sistem','stok_fisik','selisih','dugaan_penyebab','kronologi','status_kasus','created_at','pic_id','pic_nama','pic_ditetapkan_pada'],
    labels: ['ID Kasus','ID Pelapor','SKU Produk','Nama Produk','Stok Sistem','Stok Fisik','Selisih','Dugaan Penyebab','Kronologi','Status Kasus','Dibuat Pada','ID PIC','Nama PIC','Ditugaskan Pada']
  },
  evidence_files: {
    tab: 'Bukti', key: 'id_file', sortTimeKey: 'waktu_unggah',
    columns: ['id_file','id_kasus','nama_file_asli','drive_file_id','drive_view_url','waktu_unggah'],
    labels: ['ID Bukti','ID Kasus','Nama Berkas','Google Drive File ID','Google Drive URL','Waktu Unggah']
  },
  case_logs: {
    tab: 'Riwayat', key: 'id_log', sortTimeKey: 'waktu_aksi',
    columns: ['id_log','id_kasus','id_user','aksi','catatan','waktu_aksi'],
    labels: ['ID Log','ID Kasus','ID Pengguna','Aksi','Catatan','Waktu Aksi']
  },

  // V2.1 — independent intake and cashier-monitoring spreadsheet.
  // These five tables are routed to GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID,
  // never to the existing R1 spreadsheet.
  stocktrace_intakes: {
    tab: 'Penerimaan', key: 'id_intake', sortTimeKey: 'created_at',
    columns: ['id_intake','document_no','received_on','supplier','note','created_by','created_at'],
    labels: ['ID Penerimaan','No. Dokumen','Tanggal Terima','Pengirim / Supplier','Catatan','ID Pembuat','Dibuat Pada']
  },
  stocktrace_intake_items: {
    tab: 'Detail SKU', key: 'id_item', groupSortKey: 'id_intake',
    columns: ['id_item','id_intake','sku','product_name','qty_document','qty_received','qty_difference'],
    labels: ['ID Detail','ID Penerimaan','SKU','Nama Produk','Qty Dokumen','Qty Diterima','Selisih (Diterima - Dokumen)']
  },
  stocktrace_intake_evidence: {
    tab: 'Bukti Penerimaan', key: 'id_file', sortTimeKey: 'waktu_unggah',
    columns: ['id_file','id_intake','nama_file_asli','drive_file_id','drive_view_url','uploaded_by','waktu_unggah'],
    labels: ['ID Bukti','ID Penerimaan','Nama Berkas','Google Drive File ID','Google Drive URL','ID Pengunggah','Waktu Unggah']
  },
  stocktrace_cashier_requests: {
    tab: 'Permintaan Kasir', key: 'id_request', sortTimeKey: 'created_at',
    columns: ['id_request','sku','product_name','qty_system','qty_physical','qty_difference','reason','id_kasus','id_intake','status_request','created_by','created_at','updated_at','updated_by'],
    labels: ['ID Permintaan','SKU','Nama Produk','Qty Sistem','Qty Fisik','Selisih (Fisik - Sistem)','Alasan','ID Kasus R1','ID Penerimaan','Status','ID Pemohon','Dibuat Pada','Diperbarui Pada','ID Pengubah']
  },
  stocktrace_cashier_logs: {
    tab: 'Riwayat Kasir', key: 'id_log', sortTimeKey: 'created_at',
    columns: ['id_log','id_request','id_user','action','note','created_at'],
    labels: ['ID Riwayat','ID Permintaan','ID Pengguna','Aksi','Catatan','Waktu Aksi']
  }
};
const TARGETS = {
  r1: {
    spreadsheetEnv: 'GOOGLE_SHEETS_SPREADSHEET_ID',
    tables: ['cases','evidence_files','case_logs']
  },
  penerimaan: {
    spreadsheetEnv: 'GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID',
    tables: ['stocktrace_intakes','stocktrace_intake_items','stocktrace_intake_evidence','stocktrace_cashier_requests','stocktrace_cashier_logs']
  }
};
const FULL_SYNC_LEADER_ROLES=new Set(['leader']);
const COMMON_ENV_NAMES=['GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON','STOCKTRACE_SHEETS_WEBHOOK_SECRET','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];
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
const TIMESTAMP_COLUMNS = new Set(['created_at','updated_at','waktu_unggah','waktu_aksi','pic_ditetapkan_pada']);
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
function getSpreadsheetId(target){
  const envName=TARGETS[target]?.spreadsheetEnv;
  const id=envName?process.env[envName]:'';
  if(!id)throw Object.assign(new Error(`Pengaturan server belum lengkap: ${envName||'spreadsheet target tidak dikenal'}.`),{code:'CONFIG_MISSING',status:503});
  return id;
}
function targetForTable(table){
  return Object.keys(TARGETS).find(target=>TARGETS[target].tables.includes(table))||null;
}
// Keep all webhook-written body text consistent with the existing black, regular rows.
// Only text formatting is enforced: headers, borders, background colors, widths and
// conditional-format rules remain unchanged.
const BODY_TEXT_FORMAT={fontFamily:'Arial',fontSize:10,bold:false,italic:false,
  foregroundColor:{red:0,green:0,blue:0}};
async function getSheetInfo(client,sid,tab){
  const r=await client.spreadsheets.get({spreadsheetId:sid,fields:'sheets(properties(sheetId,title,gridProperties(rowCount)))'});
  const info=r.data.sheets?.find(s=>s.properties?.title===tab)?.properties;
  if(!Number.isInteger(info?.sheetId))
    throw Object.assign(new Error(`Tab ${tab} tidak tersedia.`),{status:409,code:'SHEET_NOT_FOUND'});
  return {sheetId:info.sheetId,rowCount:info.gridProperties?.rowCount||0};
}
function bodyFontRequest(sheetId,startRow,endRow,width){
  return {repeatCell:{range:{sheetId,startRowIndex:startRow-1,endRowIndex:endRow,
    startColumnIndex:0,endColumnIndex:width},
    cell:{userEnteredFormat:{textFormat:BODY_TEXT_FORMAT}},
    fields:'userEnteredFormat.textFormat'}};
}
async function formatWrittenRow(client,sid,schema,row,previousRow){
  const {sheetId,rowCount}=await getSheetInfo(client,sid,schema.tab);
  const requests=[];
  // Match the body's existing borders and fills, without copying data or formulas.
  const sourceRow=previousRow>=2?previousRow:(previousRow===1&&rowCount>=3?3:0);
  if(sourceRow && sourceRow!==row && sourceRow<=rowCount){
    requests.push({copyPaste:{
      source:{sheetId,startRowIndex:sourceRow-1,endRowIndex:sourceRow,
        startColumnIndex:0,endColumnIndex:schema.columns.length},
      destination:{sheetId,startRowIndex:row-1,endRowIndex:row,
        startColumnIndex:0,endColumnIndex:schema.columns.length},
      pasteType:'PASTE_FORMAT'}});
  }
  requests.push(bodyFontRequest(sheetId,row,row,schema.columns.length));
  await client.spreadsheets.batchUpdate({spreadsheetId:sid,requestBody:{requests}});
}
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
  }else if(schema.tab==='Kasus' && current.length===schema.labels.length-3
    && current.every((label,i)=>label===schema.labels[i])){
    // Seamless transition: old Kasus sheet has 11 columns; preserve all existing rows.
    // A Leader full resync will backfill PIC columns for historical cases.
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
    await formatWrittenRow(client,sid,schema,row,0);
    return 'updated';
  }
  // Do not use values.append + INSERT_ROWS: Google's logical-table detection can
  // insert directly below the header and shift old rows (and their formatting).
  // Instead target the first row below the last nonempty record ID explicitly.
  const lastDataRow=ids.reduce((last,r,i)=>String(r?.[0]||'').trim()?i+2:last,1);
  const nextRow=lastDataRow+1;
  const info=await getSheetInfo(client,sid,schema.tab);
  if(nextRow>info.rowCount){
    await client.spreadsheets.batchUpdate({spreadsheetId:sid,requestBody:{requests:[
      {appendDimension:{sheetId:info.sheetId,dimension:'ROWS',length:Math.max(100,nextRow-info.rowCount)}}
    ]}});
  }
  await client.spreadsheets.values.update({spreadsheetId:sid,
    range:a1(schema.tab,`A${nextRow}:${fullEnd}${nextRow}`),
    valueInputOption:'RAW',requestBody:{values}});
  await formatWrittenRow(client,sid,schema,nextRow,lastDataRow);
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
  // Chronological order: older records above, newer activity at the bottom.
  // For timestamps that match or are absent, use the unique ID as a stable tie-breaker.
  const schema=SHEETS[table];
  const timeKey=schema.sortTimeKey;
  const groupKey=schema.groupSortKey;
  const key=schema.key;
  all.sort((a,b)=>{
    if(timeKey){
      const ta=Date.parse(a[timeKey]),tb=Date.parse(b[timeKey]);
      if(Number.isFinite(ta)&&Number.isFinite(tb)&&ta!==tb)return ta-tb;
      if(Number.isFinite(ta)!==Number.isFinite(tb))return Number.isFinite(ta)?-1:1;
    }
    if(groupKey){
      const grouped=String(a[groupKey]||'').localeCompare(String(b[groupKey]||''));
      if(grouped)return grouped;
    }
    return String(a[key]||'').localeCompare(String(b[key]||''));
  });
  return all;
}
async function fullSync(client,sid,identity,tables){
  const datasets={};
  for(const table of tables)datasets[table]=await fetchAllRows(identity,table);
  // Abort early if any expected tab is missing; don't accidentally create a new tab.
  const metadata=await client.spreadsheets.get({spreadsheetId:sid,fields:'sheets(properties(title))'});
  const names=new Set((metadata.data.sheets||[]).map(s=>s.properties?.title));
  for(const table of tables){
    const config=SHEETS[table];
    if(!names.has(config.tab))throw Object.assign(new Error(`Buat tab Google Sheets bernama ${config.tab} terlebih dahulu.`),{status:409,code:'SHEET_NOT_FOUND'});
  }
  const ranges=tables.map(table=>a1(SHEETS[table].tab,'A:Z'));
  await client.spreadsheets.values.batchClear({spreadsheetId:sid,requestBody:{ranges}});
  const data=tables.map(table=>[table,SHEETS[table]]).map(([table,c])=>({
    range:a1(c.tab,`A1:${colLetter(c.columns.length)}${datasets[table].length+1}`),
    values:[c.labels,...datasets[table].map(r=>encodeRow(r,c))]
  }));
  await client.spreadsheets.values.batchUpdate({spreadsheetId:sid,requestBody:{valueInputOption:'RAW',data}});
  // The values API does not change font formatting. Normalize body text after
  // a manual resync, including rows inserted by the pre-fix webhook version.
  const metadata2=await client.spreadsheets.get({spreadsheetId:sid,fields:'sheets(properties(sheetId,title))'});
  const formatRequests=[];
  for(const table of tables){
    const schema=SHEETS[table];
    const rowCount=datasets[table].length;
    if(!rowCount)continue;
    const sheetId=metadata2.data.sheets?.find(s=>s.properties?.title===schema.tab)?.properties?.sheetId;
    if(!Number.isInteger(sheetId))continue;
    formatRequests.push(bodyFontRequest(sheetId,2,rowCount+1,schema.columns.length));
  }
  if(formatRequests.length)
    await client.spreadsheets.batchUpdate({spreadsheetId:sid,requestBody:{requests:formatRequests}});
  return Object.fromEntries(Object.entries(datasets).map(([name,rows])=>[name,rows.length]));
}
export default {
  async fetch(request){
    if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','POST only. This endpoint is not a public report.');
    if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES)return fail(413,'TOO_LARGE','Body terlalu besar.');
    try{
      const missing=COMMON_ENV_NAMES.filter(key=>!process.env[key]);
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
        const target=targetForTable(body.table);
        const client=getClient(),sid=getSpreadsheetId(target),schema=SHEETS[body.table];
        const action=body.type==='DELETE'?await deleteOne(client,sid,schema,record):await upsertOne(client,sid,schema,record);
        return json({ok:true,kind:'webhook',target,table:body.table,action});
      }
      // Existing mode "full" remains R1-only. V2.1 uses a separate explicit mode.
      const target=body?.mode==='full'?'r1':body?.mode==='full_penerimaan'?'penerimaan':null;
      if(!target)return fail(401,'UNAUTHORIZED','Akses hanya untuk webhook terotorisasi, Leader (mode full), atau Leader (mode full_penerimaan).');
      const identity=await findLeader(request);
      if(!identity)return fail(403,'LEADER_REQUIRED','Hanya akun Leader aktif yang dapat sinkronisasi penuh.');
      const client=getClient(),sid=getSpreadsheetId(target),counts=await fullSync(client,sid,identity,TARGETS[target].tables);
      return json({ok:true,kind:'full',target,counts});
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
