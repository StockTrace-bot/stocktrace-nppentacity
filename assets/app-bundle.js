// --- xlsx-export.js ---
/* StockTrace V2.1 — minimal OpenXML .xlsx writer, no third-party CDN or macros.
 * ZIP stored entries + CRC32; uses inline strings; Excel formulas are NEVER emitted.
 * Exposes window.StockTraceXlsx = {create,save}; supports multiple worksheets. */
(function(root){
 'use strict';
 const enc=new TextEncoder();
 const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const alpha=index=>{let out='';for(let n=index;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
 const crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
 function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=crcTable[(c^bytes[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
 function sheetXml(rows){
  const maxCol=Math.max(1,...rows.map(r=>r.length));
  const dimension='A1:'+alpha(maxCol)+Math.max(1,rows.length);
  const lines=rows.map((r,ri)=>'<row r="'+(ri+1)+'">'+r.map((v,ci)=>{
   if(v===null||v===undefined||v==='')return '';
   const ref=alpha(ci+1)+(ri+1);
   // Only finite numeric input becomes a numeric cell. Other input is inert literal text.
   if(typeof v==='number'&&Number.isFinite(v))return '<c r="'+ref+'"><v>'+v+'</v></c>';
   return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(String(v).slice(0,32767))+'</t></is></c>';
  }).join('')+'</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="'+dimension+'"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>'+lines+'</sheetData></worksheet>';
 }
 function u16(arr,x){arr.push(x&255,(x>>>8)&255);}
 function u32(arr,x){arr.push(x&255,(x>>>8)&255,(x>>>16)&255,(x>>>24)&255);}
 function packageZip(entries){
  const all=[],central=[];let offset=0;
  const append=(dest,bytes)=>{for(const v of bytes)dest.push(v);};
  for(const [name,body] of entries){
   const filename=enc.encode(name),bytes=enc.encode(body),crc=crc32(bytes),header=[];
   u32(header,0x04034b50);u16(header,20);u16(header,0x0800);u16(header,0);u16(header,0);u16(header,0);
   u32(header,crc);u32(header,bytes.length);u32(header,bytes.length);u16(header,filename.length);u16(header,0);
   append(all,header);append(all,filename);append(all,bytes);
   const c=[];u32(c,0x02014b50);u16(c,20);u16(c,20);u16(c,0x0800);u16(c,0);u16(c,0);u16(c,0);
   u32(c,crc);u32(c,bytes.length);u32(c,bytes.length);u16(c,filename.length);u16(c,0);u16(c,0);
   u16(c,0);u16(c,0);u32(c,0);u32(c,offset);append(c,filename);append(central,c);
   offset+=header.length+filename.length+bytes.length;
  }
  const centralOffset=all.length;append(all,central);
  const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,entries.length);u16(end,entries.length);
  u32(end,central.length);u32(end,centralOffset);u16(end,0);append(all,end);
  return new Uint8Array(all);
 }
 function create(sheets){
  if(!Array.isArray(sheets)||!sheets.length||sheets.length>10)throw Error('Dibutuhkan 1–10 lembar kerja.');
  const names=new Set();
  sheets.forEach(s=>{if(!s?.name||!/^[^\[\]\*\/\\?:]{1,31}$/.test(s.name)||names.has(s.name))throw Error('Nama worksheet duplikat/tidak valid.');names.add(s.name);if(!Array.isArray(s.rows))throw Error('Baris worksheet tidak valid.');});
  const list=sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
  const links=sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('');
  const types=sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  const entries=[
   ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+types+'</Types>'],
   ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+list+'</sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+links+'<Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
   ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
  ];
  sheets.forEach((s,i)=>entries.push(['xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(s.rows)]));
  return packageZip(entries);
 }
 function save(sheets,filename){
  const bytes=create(sheets),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=filename.endsWith('.xlsx')?filename:filename+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
 }
 root.StockTraceXlsx={create,save};
})(globalThis);
;

// --- app.js ---
/* StockTrace Integrated — disesuaikan dengan Supabase: status_kasus/waktu_aksi/waktu_unggah.
 * Hanya publishable key di frontend; seluruh OAuth secret harus tetap di Vercel.
 */
let sb=null; // initialized from server-side public config; preview cannot silently hit production
const el=id=>document.getElementById(id);
const toText=v=>v===null||v===undefined?'':String(v);
const htmlEscape=v=>toText(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const allowedExtensions=new Set(['jpg','jpeg','png','pdf','mp4','webm','doc','docx','xls','xlsx','csv','txt']);
const statuses=['Baru Dilaporkan','Dalam Pemeriksaan','Menunggu Tindak Lanjut IT/MD','Dalam Penyelesaian','Selesai'];
const picProgressStatuses=['Sedang Diperiksa','Menunggu Informasi','Selesai Diperiksa'];
let activeUser=null,activeRole='Staff',cachedCases=[],selectedCase=null,staffDirectory=[],mustChangePassword=false;
let casesLoadedAt=0,casesLoadedOnce=false,casesLoadPromise=null;
const directoryNameById=new Map();
function displayPerson(id){return directoryNameById.get(String(id||''))||(id===activeUser?.id?'Saya':'Pengguna tercatat');}
async function loadStaffDirectory(){
 const {data,error}=await sb.rpc('stocktrace_staff_directory');
 if(error)throw new Error('Daftar Staff belum siap: '+error.message);
 staffDirectory=Array.isArray(data)?data:[];directoryNameById.clear();
 staffDirectory.forEach(u=>directoryNameById.set(String(u.id_user),u.nama_lengkap||'Nama belum diisi'));
 const select=el('selectPIC');if(!select)return;
 const previous=select.value;select.replaceChildren(new Option('Belum ditugaskan',''));
 staffDirectory.filter(u=>String(u.role||'').toLowerCase().trim()==='staff')
  .forEach(u=>select.add(new Option(u.nama_lengkap,String(u.id_user))));
 select.value=[...select.options].some(o=>o.value===previous)?previous:'';
}

function notice(title,message,icon='info'){
 if(window.Swal?.fire)return window.Swal.fire({title,text:toText(message),icon,confirmButtonColor:'#1E293B'});
 window.alert(`${title}\n${message}`);return Promise.resolve();
}
function redirectLogin(){window.location.replace('login.html');}
function finishAuthBoot(){
 document.body.classList.remove('st-auth-pending','st-auth-error');
 const boot=el('authBootScreen');if(boot)boot.setAttribute('aria-hidden','true');
}
function showAuthBootError(message){
 document.body.classList.add('st-auth-pending','st-auth-error');
 const boot=el('authBootScreen');if(boot)boot.setAttribute('aria-hidden','false');
 const text=el('authBootMessage');if(text)text.textContent=message||'Aplikasi belum dapat memverifikasi sesi. Periksa koneksi lalu coba lagi.';
 const retry=el('authBootRetry');if(retry)retry.hidden=false;
}
function canManageCases(){return activeRole.toLowerCase().trim()==='leader';}
function niceDate(value){if(!value)return 'Waktu belum dicatat';let d=new Date(value);if(isNaN(d.getTime()))return 'Waktu tidak valid';return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'}).format(d)+' WITA';}
function showView(view){
 if(view==='archive'&&!canManageCases()){
  notice('Akses terbatas','Menu Arsip & Sampah hanya dapat dibuka oleh Leader.','warning');
  view='dashboard';
 }
 if(mustChangePassword&&view!=='account'){view='account';}
 for(const name of ['dashboard','cases','form-laporan','detail-kasus','archive','reports','intake','cashier','account','products','sales']){
  const node=el('view-'+name); if(node){node.classList.toggle('hidden',view!==name);node.classList.toggle('block',view===name);}
 }
 // Jaga penanda menu aktif sama di sidebar laptop dan nav HP.
 el('retailTopScan').disabled=mustChangePassword||(view==='form-laporan'&&el('inputSKU').readOnly);
 const section=['cases','form-laporan','detail-kasus','reports','cashier','archive','products'].includes(view);
 const activeView=section?'products':view;
 el('inventoryNav').hidden=!section;
 const subview=['form-laporan','detail-kasus'].includes(view)?'cases':view==='cashier'?'reports':view;
 document.querySelectorAll('[data-workspace-view]').forEach(button=>{const selected=button.dataset.workspaceView===subview;button.classList.toggle('st-workspace-active',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 el('inventoryNav').querySelector('[data-workspace-view="archive"]').hidden=!canManageCases();
 document.querySelectorAll('[data-nav-view]').forEach(button=>{
  const selected=button.dataset.navView===(button.closest('#appSidebar')?activeView:view);
  button.classList.toggle('st-active-nav',selected);
  if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
 if(['dashboard','cases'].includes(view)&&activeUser)loadCases();
 if(view!=='detail-kasus'&&view!=='cashier')v21SelectedCashier=null;
 if(view==='cashier'){el('cashierHistoryDetail').append(el('cashierDetail'));el('cashierDetail').replaceChildren();v21SelectedCashier=null;}
 if(view==='archive'&&activeUser)loadArchive();
 if(view==='reports'&&activeUser)loadCases().then(renderReports);
 if(view==='intake'&&activeUser)loadIntakes();
 if(view==='cashier'&&activeUser)loadCashier();
 if(typeof retailView==='function')retailView(view);
 if(view==='account'&&activeUser){const p=el('passwordChangeForm');if(p)p.reset();}
}
async function checkAuth(){
 if(!sb){showAuthBootError('Koneksi Supabase gagal dimuat. Periksa koneksi lalu coba lagi.');return;}
 try{
  const {data:{user},error}=await sb.auth.getUser();
  if(error||!user)return redirectLogin();
  activeUser=user;
  const {data:{session:secureSession},error:sessionError}=await sb.auth.getSession();
  if(sessionError||!secureSession?.access_token)return redirectLogin();
  // Profile and account-security checks must pass before any application view is revealed.
  const [profileResult,securityResponse]=await Promise.all([
   sb.from('users').select('role,nama_lengkap,login_id').eq('id_user',user.id).single(),
   fetch('/api/account-password',{headers:{Authorization:`Bearer ${secureSession.access_token}`}})
  ]);
  const {data:profile,error:profileError}=profileResult;
  if(profileError||!profile)throw new Error('Profil akun belum dapat diverifikasi: '+(profileError?.message||'profil tidak ditemukan'));
  const securityData=await securityResponse.json().catch(()=>({}));
  if(!securityResponse.ok||typeof securityData.must_change_password!=='boolean')throw new Error(securityData.error||'Keamanan akun belum dapat diverifikasi.');
  activeRole=profile.role||'Staff';
  const name=profile.nama_lengkap||'Pengguna';
  el('displayUserName').textContent=name;
  el('displayUserRole').textContent=activeRole;
  el('profilInisial').textContent=name.slice(0,1).toUpperCase();
  el('accountLoginId').textContent=profile.login_id||'Belum diaktifkan';
  mustChangePassword=securityData.must_change_password;
  document.body.classList.toggle('st-password-required',mustChangePassword);
  el('panelTindakLanjutLeader').style.display=canManageCases()?'':'none';
  const archiveNav=document.querySelector('[data-workspace-view="archive"]');
  if(archiveNav)archiveNav.hidden=!canManageCases();
  el('view-detail-kasus').classList.toggle('staff-detail-centered',!canManageCases());
  el('btnSyncSheets').style.display=canManageCases()?'':'none';
  if(mustChangePassword){
   showView('account');
   finishAuthBoot();
   await notice('Perbarui kata sandi','Akun menggunakan kata sandi sementara. Ganti kata sandi terlebih dahulu untuk mengakses laporan.','warning');
   return;
  }
  // Reveal the authenticated shell only after identity, role, and security are verified.
  finishAuthBoot();
  const directoryTask=loadStaffDirectory().catch(dirError=>{
   console.warn(dirError.message);
   el('picFormHint').textContent='Daftar Staff belum tersedia. Hubungi administrator.';
  });
  await Promise.all([directoryTask,loadCases({force:true})]);
 }catch(e){
  activeUser=null;activeRole='Staff';mustChangePassword=false;
  console.error('StockTrace authentication bootstrap failed:',e);
  showAuthBootError(e.message||'Profil dan hak akses belum dapat diverifikasi.');
 }
}
async function syncSheetsNow(){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader dapat menjalankan sinkronisasi penuh.','warning');
 const btn=el('btnSyncSheets');if(btn){btn.disabled=true;btn.textContent='Sinkronisasi semua...';}
 const completed=[];
 try{
  const {data:{session},error}=await sb.auth.getSession();
  if(error||!session?.access_token)throw new Error('Sesi Supabase kedaluwarsa. Silakan masuk kembali.');
  const targets=[
   {mode:'full',label:'Laporan dan bukti'},
   {mode:'full_penerimaan',label:'Penerimaan dan kasir'},
   {mode:'full_penjualan',label:'Produk, penjualan dan retur'}
  ];
  const counts={},failed=[];
  for(const target of targets){
   try{
   const response=await fetch('/api/sheets-sync',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({mode:target.mode})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw new Error(`${target.label}: ${result.message||'Sinkronisasi gagal.'}`);
   completed.push(target.label);counts[target.mode]=result.counts||{};
   }catch(err){failed.push(target.label+": "+err.message);}
  }
  if(failed.length)throw Error(failed.join("; "));
  const r1=counts.full||{},v21=counts.full_penerimaan||{},sales=counts.full_penjualan||{};
  await notice('Semua Google Sheets diperbarui',`Laporan: ${r1.cases||0} kasus, ${r1.evidence_files||0} bukti, ${r1.case_logs||0} riwayat. Penerimaan dan kasir: ${Object.values(v21).reduce((a,b)=>a+(Number(b)||0),0)} baris penerimaan dan kasir. Penjualan: ${Object.values(sales).reduce((a,b)=>a+(Number(b)||0),0)} baris.`,'success');
 }catch(e){
  const partial=completed.length?`Berhasil: ${completed.join('; ')}. `:'';
  await notice('Sinkronisasi belum lengkap',partial+e.message,'error');
 }finally{if(btn){btn.disabled=false;btn.textContent='Sinkronkan Google Sheets';}}
}
async function logout(){try{await sb?.auth.signOut();}catch(e){console.warn(e)}try{sessionStorage.removeItem('user_role');sessionStorage.removeItem('user_name');}catch(_){}redirectLogin();}
function displayCases(){
 const q=el('searchCases').value.toLowerCase().trim(), filter=el('filterCaseStatus').value, picFilter=el('filterCasePIC').value;
 const list=cachedCases.filter(c=>(!filter||toText(c.status_kasus||statuses[0])===filter)&&(!picFilter||(picFilter==='mine'?c.pic_id===activeUser?.id:picFilter==='reported'?c.id_pelapor===activeUser?.id:picFilter==='unassigned'?!c.pic_id:true))&&[c.id_kasus,c.sku_produk,c.nama_produk].some(x=>toText(x).toLowerCase().includes(q)));
 el('dashboardCasesBody').innerHTML=list.map(c=>`<tr class="border-b"><td class="py-3 pr-4"><button type="button" data-case-id="${htmlEscape(c.id_kasus)}" class="text-blue-600 font-semibold underline">${htmlEscape(c.id_kasus)}</button></td><td class="py-3 pr-4">${htmlEscape(c.nama_produk)}<span class="text-xs text-slate-400 block">${htmlEscape(c.sku_produk)}</span></td><td class="py-3 pr-4">${htmlEscape(c.selisih)}</td><td class="py-3 pr-4 text-xs"><span class="block">Pelapor: ${htmlEscape(displayPerson(c.id_pelapor))}</span><span class="block mt-1 text-slate-500">PIC: ${htmlEscape(c.pic_nama||'Belum ditugaskan')}</span></td><td class="py-3"><span class="status-chip">${htmlEscape(c.status_kasus||statuses[0])}</span></td></tr>`).join('');
 el('dashboardNotice').textContent=list.length?'':(q||filter?'Tidak ada kasus yang cocok.':'Belum ada kasus yang dapat diakses.');
}
async function loadCases(options={}){
 if(!sb||!activeUser)return;
 const force=options?.force===true;
 if(!force&&casesLoadedOnce&&Date.now()-casesLoadedAt<12000){displayCases();return;}
 if(casesLoadPromise)return casesLoadPromise;
 const task=(async()=>{
  el('dashboardNotice').textContent='Memuat laporan...';
  const {data,error}=await sb.from('cases')
   .select('id_kasus,id_pelapor,sku_produk,nama_produk,stok_sistem,stok_fisik,selisih,dugaan_penyebab,kronologi,status_kasus,created_at,pic_id,pic_nama,pic_ditetapkan_pada,deleted_at,source_intake_id')
   .is('deleted_at',null).order('created_at',{ascending:false}).limit(500);
  if(error){el('dashboardNotice').textContent='Gagal membaca kasus: '+error.message;return;}
  cachedCases=data||[];casesLoadedAt=Date.now();casesLoadedOnce=true;
  el('countTotal').textContent=cachedCases.length;
  el('countClosed').textContent=cachedCases.filter(c=>(c.status_kasus||statuses[0])==='Selesai').length;
  el('countOpen').textContent=cachedCases.filter(c=>(c.status_kasus||statuses[0])!=='Selesai').length;
  el('countEscalated').textContent=cachedCases.filter(c=>c.status_kasus==='Menunggu Tindak Lanjut IT/MD').length;
  displayCases();
 })();
 casesLoadPromise=task;
 try{return await task;}finally{if(casesLoadPromise===task)casesLoadPromise=null;}
}
async function openCase(id){
 selectedCase=cachedCases.find(c=>c.id_kasus===id)||null;
 if(!selectedCase){const {data,error}=await sb.from('cases').select('*').eq('id_kasus',id).is('deleted_at',null).maybeSingle();if(error||!data)return notice('Laporan tidak ditemukan','Muat ulang daftar pemeriksaan.','warning');selectedCase=data;}
 const c=selectedCase;el('caseCorrectionDetail').append(el('cashierDetail'));el('cashierDetail').replaceChildren();v21SelectedCashier=null;el('detailTitle').textContent='Pemeriksaan: '+c.id_kasus;el('btnCaseSourceIntake').hidden=!c.source_intake_id;
  const archiveButton=el('btnArchiveCase');if(archiveButton){const canArchive=canManageCases()||(c.id_pelapor===activeUser?.id&&c.status_kasus==='Baru Dilaporkan'&&!c.pic_id);archiveButton.style.display=canArchive?'':'none';}
 const pairs=[['ID kasus',c.id_kasus],['Produk',c.nama_produk],['SKU',c.sku_produk],['Stok kasir',c.stok_sistem],['Stok fisik',c.stok_fisik],['Selisih fisik − kasir',c.selisih],['Dugaan penyebab',c.dugaan_penyebab],['Kronologi',c.kronologi],...(c.source_intake_id?[['Penerimaan',c.source_intake_id]]:[]),['Pelapor',displayPerson(c.id_pelapor)],['PIC penanganan',c.pic_nama||'Belum ditugaskan'],['Penugasan PIC',c.pic_ditetapkan_pada?niceDate(c.pic_ditetapkan_pada):'—'],['Status',c.status_kasus||statuses[0]],['Dibuat',niceDate(c.created_at)]];
 el('detailInfo').innerHTML='<dl class="grid grid-cols-1 sm:grid-cols-2 gap-3">'+pairs.map(([k,v])=>`<div class="bg-slate-50 p-3 rounded"><dt class="text-xs uppercase text-slate-500">${htmlEscape(k)}</dt><dd class="text-sm whitespace-pre-wrap break-words mt-1">${htmlEscape(v)}</dd></div>`).join('')+'</dl>';
 el('selectStatus').value=statuses.includes(c.status_kasus)?c.status_kasus:statuses[0];el('inputStatusNote').value='';
 if(canManageCases()){
  const picSelect=el('selectPIC');const exists=[...picSelect.options].some(o=>o.value===toText(c.pic_id));
  picSelect.value=exists?toText(c.pic_id):'';
  el('inputPICNote').value='';
  el('picFormHint').textContent=c.pic_id&&!exists?'PIC lama tidak ada dalam daftar Staff aktif. Pilih Staff pengganti jika diperlukan.':'';
 }
 el('detailEvidence').textContent='Memuat bukti...';el('detailHistory').textContent='Memuat riwayat...';
 showView('detail-kasus');
 await Promise.all([loadEvidence(id),loadHistory(id),loadPICProgress(id,c),loadLinkedCorrection(id)]);
}
async function loadPICProgress(id,c=selectedCase){
 const panel=el('panelPICProgress'),editor=el('picProgressEditor');
 const isLeader=canManageCases();
 const isPIC=Boolean(c?.pic_id)&&String(c.pic_id)===String(activeUser?.id);
 const canView=Boolean(c?.pic_id)&&(isLeader||isPIC);
 panel.classList.toggle('hidden',!canView);
 if(!canView)return;
 const canEdit=isPIC&&c.status_kasus!=='Selesai';
 editor.classList.toggle('hidden',!canEdit);
 el('picProgressStatus').textContent='Memuat...';
 el('picProgressNoteCurrent').textContent='';
 el('picProgressMeta').textContent='';
 try{
  const {data,error}=await sb.from('stocktrace_pic_progress')
   .select('progress_status,progress_note,updated_by,updated_at')
   .eq('id_kasus',id).maybeSingle();
  if(error)throw new Error(error.message);
  el('picProgressStatus').textContent=data?.progress_status||'Belum Dimulai';
  el('picProgressNoteCurrent').textContent=data?.progress_note||'Belum ada catatan progres.';
  el('picProgressMeta').textContent=data
   ?`Diperbarui ${niceDate(data.updated_at)} · ${displayPerson(data.updated_by)}`
   :'Belum ada pembaruan.';
  if(isPIC&&c.status_kasus!=='Selesai'){
   el('picProgressSelect').value=picProgressStatuses.includes(data?.progress_status)?data.progress_status:picProgressStatuses[0];
   el('picProgressNote').value='';
  }
  el('picProgressHint').textContent='';
 }catch(error){
  el('picProgressStatus').textContent='Belum tersedia';
  el('picProgressNoteCurrent').textContent='Fitur progres PIC belum aktif.';
  console.warn('PIC progress could not be loaded:',error.message);
  el('picProgressMeta').textContent='Fitur belum aktif. Hubungi admin.';
  editor.classList.add('hidden');
 }
}
async function loadEvidence(id){
  const {data,error}=await sb.from('evidence_files').select('id_file,id_kasus,nama_file_asli,drive_file_id,drive_view_url,waktu_unggah,uploaded_by,deleted_at').eq('id_kasus',id).order('waktu_unggah',{ascending:false}).limit(150);
 if(selectedCase?.id_kasus!==id)return;
 if(error){el('detailEvidence').textContent='Gagal membaca bukti: '+error.message;return;}
  const activeFiles=(data||[]).filter(f=>!f.deleted_at);
  if(!activeFiles.length){el('detailEvidence').textContent='Belum ada berkas aktif.';return;}
  el('detailEvidence').innerHTML=activeFiles.map(f=>{const canArchive=canManageCases()||(f.uploaded_by===activeUser?.id&&selectedCase?.id_pelapor===activeUser?.id&&selectedCase?.status_kasus==='Baru Dilaporkan'&&!selectedCase?.pic_id);return `<div class="bg-slate-50 rounded border p-3 mb-2 flex gap-3 justify-between items-center flex-wrap"><div class="break-all min-w-0"><strong>${htmlEscape(f.nama_file_asli||'Berkas')}</strong><p class="text-xs text-slate-400">${htmlEscape(niceDate(f.waktu_unggah))}</p></div><div class="flex gap-3 items-center"><button type="button" class="text-blue-700 underline text-xs" data-download-case="${htmlEscape(id)}" data-download-id="${htmlEscape(f.drive_file_id)}" data-download-name="${htmlEscape(f.nama_file_asli)}">Unduh aman</button>${canArchive?`<button type="button" class="st-archive-action" data-archive-record="evidence" data-archive-id="${htmlEscape(f.id_file)}">Arsipkan</button>`:''}</div></div>`;}).join('');
}
async function loadHistory(id){
 const {data,error}=await sb.from('case_logs').select('id_user,aksi,catatan,waktu_aksi').eq('id_kasus',id).order('waktu_aksi',{ascending:false}).limit(150);
 if(selectedCase?.id_kasus!==id)return;
 if(error){el('detailHistory').textContent='Gagal membaca riwayat: '+error.message;return;}
 if(!data?.length){el('detailHistory').textContent='Belum ada catatan tindak lanjut.';return;}
 if(selectedCase?.id_kasus!==id)return;
 el('detailHistory').innerHTML=data.map(log=>`<div class="border-l-2 border-blue-300 pl-4 pb-3"><strong>${htmlEscape(log.aksi)}</strong><p class="text-xs text-slate-400">${htmlEscape(niceDate(log.waktu_aksi))} • ${htmlEscape(displayPerson(log.id_user))}</p><p class="mt-1 break-words whitespace-pre-wrap">${htmlEscape(log.catatan)}</p></div>`).join('');
}
async function saveStatus(){
 if(!canManageCases())return notice('Akses tidak diizinkan','Hanya Leader.','warning');
 if(!selectedCase)return notice('Kasus belum dipilih','Buka kasus dari daftar.','warning');
 const status=el('selectStatus').value,note=el('inputStatusNote').value.trim(),id=selectedCase.id_kasus;
 if(!statuses.includes(status)||note.length<8)return notice('Data belum lengkap','Pilih status dan isi catatan minimal 8 karakter.','warning');
 const btn=el('btnSimpanStatus');btn.disabled=true;btn.textContent='Menyimpan...';
 try{
  const {data,error}=await sb.rpc('stocktrace_update_case_status',{p_case_id:id,p_status:status,p_note:note});
  if(error)throw new Error(error.message);
  if(!data?.ok)throw new Error('Database tidak mengonfirmasi perubahan.');
  await loadCases({force:true});await openCase(id);await notice('Berhasil','Status kasus berhasil diperbarui.','success');
 }catch(e){await notice('Belum dapat memperbarui',e.message,'error');}
 finally{btn.disabled=false;btn.textContent='Simpan status & catatan';}
}
async function savePIC(){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader dapat menetapkan PIC.','warning');
 if(!selectedCase)return notice('Kasus belum dipilih','Buka kasus dari dashboard.','warning');
 const btn=el('btnSimpanPIC'),id=selectedCase.id_kasus,pic=el('selectPIC').value||null,note=el('inputPICNote').value.trim();
 if(note.length<8||note.length>2000)return notice('Catatan wajib','Isi alasan penugasan minimal 8 karakter (maksimal 2000).','warning');
 if(toText(selectedCase.pic_id)===toText(pic))return notice('PIC belum berubah','Pilih Staff berbeda atau kosongkan PIC jika ingin membatalkan penugasan.','warning');
 btn.disabled=true;btn.textContent='Menyimpan penugasan...';
 try{
  const {data,error}=await sb.rpc('stocktrace_assign_pic',{p_case_id:id,p_pic_user_id:pic,p_note:note});
  if(error)throw new Error(error.message);
  if(!data?.ok)throw new Error('Database tidak mengonfirmasi penugasan.');
  await loadCases({force:true});await openCase(id);
  await notice('PIC berhasil diperbarui',pic?`PIC ${data.pic_name||displayPerson(pic)} berhasil ditetapkan.`:'Penugasan PIC berhasil dilepas.','success');
 }catch(e){await notice('Gagal memperbarui PIC',e.message,'error');}
 finally{btn.disabled=false;btn.textContent='Simpan penugasan PIC';}
}
async function savePICProgress(){
 const c=selectedCase;
 if(!c||!Boolean(c.pic_id)||String(c.pic_id)!==String(activeUser?.id))
  return notice('Akses ditolak','Hanya PIC yang ditugaskan pada kasus ini yang dapat memperbarui progres.','warning');
 if(c.status_kasus==='Selesai')
  return notice('Kasus sudah selesai','Progres tidak dapat diubah setelah Leader menyelesaikan kasus.','warning');
 const status=el('picProgressSelect').value,note=el('picProgressNote').value.trim(),id=c.id_kasus;
 if(!picProgressStatuses.includes(status)||note.length<8||note.length>2000)
  return notice('Catatan belum lengkap','Pilih progres dan isi catatan minimal 8 karakter.','warning');
 const btn=el('btnSavePICProgress');btn.disabled=true;btn.textContent='Menyimpan...';
 try{
  const {data,error}=await sb.rpc('stocktrace_update_pic_progress',{
   p_case_id:id,p_progress_status:status,p_note:note
  });
  if(error)throw new Error(error.message);
  if(!data?.ok)throw new Error('Database tidak mengonfirmasi pembaruan progres.');
  await loadCases({force:true});await openCase(id);
  await notice('Progres tersimpan','Progres pemeriksaan berhasil disimpan.','success');
 }catch(error){await notice('Gagal menyimpan progres',error.message,'error');}
 finally{btn.disabled=false;btn.textContent='Simpan progres';}
}

function validateFiles(files){
 if(!files.length){notice('Bukti belum dipilih','Pilih foto, PDF, atau berkas lain dahulu.','warning');return false;}
 for(const f of files){
  const ext=toText(f.name).split('.').pop().toLowerCase();
  if(!allowedExtensions.has(ext)){notice('Tipe berkas tidak didukung',f.name,'warning');return false;}
  if(f.size<=0||f.size>100*1024*1024){notice('Ukuran berkas tidak sesuai',`${f.name}: tiap file harus 1 byte sampai 100 MiB.`,'warning');return false;}
 }
 return true;
}
function makeCaseId(){const d=new Date();const s=String(d.getFullYear()).slice(-2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');const r=globalThis.crypto?.randomUUID?.()||('fallback'+Math.random().toString(36).slice(2)+Date.now());return 'ST-'+s+'-'+r.replaceAll('-','').slice(0,12);}
// Upload larger media directly browser -> Google Drive using a short-lived, restricted session.
// Only the two small start/verify JSON requests reach Vercel. Never log/share session_url.
const DIRECT_CHUNK_BYTES=8*1024*1024;
const directWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function driveControl(action,details,token){
 const resp=await fetch('/api/drive-upload',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify({action,...details})});
 const result=await resp.json().catch(()=>({}));
 if(!resp.ok||!result.success)throw new Error(result.error||`Drive ${action} gagal (HTTP ${resp.status}).`);
 return result;
}
function parseDriveRange(resp){
 const h=resp.headers.get('range');const m=/^bytes=0-(\d+)$/i.exec(h||'');
 return m?Number(m[1])+1:null;
}
function isDriveSessionUrl(url){
 try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.googleapis.com'&&u.pathname.startsWith('/upload/drive/');}
 catch{return false;}
}
async function queryDriveProgress(url,file){
 const r=await fetch(url,{method:'PUT',headers:{'Content-Range':`bytes */${file.size}`},body:new Blob([]),
   credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
 if(r.ok)return {complete:await r.json()};
 if(r.status===308){const offset=parseDriveRange(r);if(offset===null)throw new Error('Google belum mengekspos posisi upload. Hindari unggah ulang sebelum memeriksa Drive.');return {offset};}
 if(r.status===404||r.status===410)throw new Error('Sesi upload Google kedaluwarsa. Mulai unggah ulang setelah memeriksa Drive.');
 throw new Error('Tidak bisa mengecek kelanjutan upload Google (HTTP '+r.status+').');
}
async function uploadToBackend(file,id,token,onProgress=()=>{}){
 if(location.protocol==='file:')throw new Error('Upload hanya bisa dari alamat website HTTPS Vercel.');
 const details={case_id:id,filename:file.name,size:file.size,type:file.type||'application/octet-stream'};
 const start=await driveControl('start',details,token);
 const url=start.session_url;
 if(!isDriveSessionUrl(url))throw new Error('URL sesi Google tidak valid.');
 let offset=0,completed=null;
 while(offset<file.size&&!completed){
  const end=Math.min(offset+DIRECT_CHUNK_BYTES,file.size);
  const chunk=file.slice(offset,end);
  let retry=0;
  while(true){
   try{
    const r=await fetch(url,{method:'PUT',headers:{'Content-Type':details.type,'Content-Range':`bytes ${offset}-${end-1}/${file.size}`},
      body:chunk,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
    if(r.ok){completed=await r.json();offset=file.size;onProgress(100);break;}
    if(r.status===308){
     const fromHeader=parseDriveRange(r);
     if(fromHeader!==null){offset=fromHeader;onProgress(Math.floor(100*offset/file.size));break;}
     const state=await queryDriveProgress(url,file);
     if(state.complete){completed=state.complete;offset=file.size;onProgress(100);break;}
     offset=state.offset;onProgress(Math.floor(100*offset/file.size));break;
    }
    if(![429,500,502,503,504].includes(r.status))throw Object.assign(new Error('Google menolak chunk (HTTP '+r.status+').'),{fatal:true});
    throw new Error('Google sementara gagal (HTTP '+r.status+').');
   }catch(err){
    if(err.fatal)throw err;
    if(++retry>3)throw new Error('Upload langsung ke Drive terputus atau ditolak browser (CORS/jaringan). Periksa Drive sebelum mengulangi. '+err.message);
    await directWait(500*2**(retry-1));
    try{
     const state=await queryDriveProgress(url,file);
     if(state.complete){completed=state.complete;offset=file.size;onProgress(100);break;}
     if(state.offset>=end){offset=state.offset;onProgress(Math.floor(100*offset/file.size));break;}
     if(state.offset!==offset){offset=state.offset;break;}
    }catch(probeErr){
     if(retry===3)throw new Error('Tidak dapat memastikan posisi upload. Periksa Google Drive sebelum mencoba ulang. '+probeErr.message);
    }
   }
  }
 }
 if(!completed?.id)throw new Error('Google Drive belum mengonfirmasi file. Periksa Drive sebelum mencoba ulang.');
 // Verify server-side owner, case, folder, name, and exact file size before writing metadata.
 const verified=await driveControl('verify',{...details,file_id:completed.id},token);
 return verified;
}
async function uploadFileBatch(files,id,session,progress,options={}){
 const table=options.table||'evidence_files',idField=options.idField||'id_kasus';
 const includeUploader=options.includeUploader===true;
 const states=files.map(file=>({file,status:'Menunggu',pct:0}));
 const errors=[];let count=0;
 const paint=()=>{
  if(!progress)return;
  const active=states.filter(x=>x.status==='Mengunggah').map(x=>`${x.file.name} ${x.pct}%`).slice(0,2);
  const failed=states.filter(x=>x.status==='Gagal').length;
  const saved=states.filter(x=>x.status==='Tersimpan').length;
  progress.textContent=`${saved}/${files.length} tersimpan${active.length?' · '+active.join(' | '):''}${failed?' · '+failed+' gagal':''}`;
 };
 // Dua file berjalan bersamaan agar upload multi-bukti lebih cepat tanpa membebani HP/jaringan.
 for(let start=0;start<files.length;start+=2){
  const batch=files.slice(start,start+2);
  const results=await Promise.all(batch.map(async(file,index)=>{
   const fileIndex=start+index,state=states[fileIndex];
   state.status='Mengunggah';state.pct=0;paint();
   try{
    const data=await uploadToBackend(file,id,session.access_token,pct=>{state.pct=pct;paint();});
    return {file,fileIndex,data};
   }catch(error){
    state.status='Gagal';state.message=error?.message||'Upload gagal';
    errors.push(file.name+': '+state.message);paint();return null;
   }
  }));
  const completed=results.filter(Boolean);
  if(completed.length){
   const records=completed.map(({file,data})=>({
    [idField]:id,nama_file_asli:file.name,drive_file_id:data.drive_file_id,drive_view_url:data.drive_link,
    ...(includeUploader?{uploaded_by:activeUser.id}:{}),
    ...(options.extraFields&&typeof options.extraFields==='object'?options.extraFields:{})
   }));
   const bulk=await sb.from(table).insert(records);
   if(!bulk.error){
    completed.forEach(({fileIndex})=>{states[fileIndex].status='Tersimpan';count++;});
   }else{
    // Jika insert batch ditolak, coba satu per satu agar satu metadata bermasalah
    // tidak menggagalkan bukti lain yang sudah berhasil diunggah ke Drive.
    const fallback=await Promise.all(completed.map(async(item,i)=>{
     const result=await sb.from(table).insert([records[i]]);
     return {item,error:result.error};
    }));
    for(const result of fallback){
     if(result.error){
      states[result.item.fileIndex].status='Gagal';
      states[result.item.fileIndex].message='File mungkin sudah masuk Drive, tetapi metadata gagal: '+result.error.message;
      errors.push(result.item.file.name+': '+states[result.item.fileIndex].message);
     }else{
      states[result.item.fileIndex].status='Tersimpan';count++;
     }
    }
   }
  }
  paint();
 }
 if(progress)progress.textContent=`Selesai ${count}/${files.length} berkas tersimpan.${errors.length?' Periksa berkas yang gagal sebelum mencoba ulang.':''}`;
 return {count,errors};
}
async function uploadFiles(files,id,session,button){
 const progress=button?.id==='btnSubmitLaporan'?el('uploadProgressReport'):el('uploadProgressExtra');
 if(button)button.textContent=`Mengunggah ${files.length} berkas...`;
 return uploadFileBatch(files,id,session,progress,{table:'evidence_files',idField:'id_kasus',includeUploader:true});
}
async function submitReport(ev){
 ev.preventDefault();if(!activeUser)return redirectLogin();if(el('btnSubmitLaporan').disabled)return;
 const sys=v21Int(el('inputSistem')),fis=v21Int(el('inputFisik'));
 if(sys===null||fis===null)return notice('Stok tidak valid','Masukkan stok kasir dan stok fisik.','warning');
 if(!Number.isSafeInteger(sys)||!Number.isSafeInteger(fis)||sys<0||fis<0)return notice('Stok tidak valid','Masukkan bilangan bulat tidak negatif.','warning');
 if(sys===fis){el('formLaporanLengkap').reset();showView('products');return notice('Stok sesuai','Tidak perlu membuat laporan selisih.','success');}
 const files=[...el('inputFile').files];if(!validateFiles(files))return;
 const sku=el('inputSKU').value.trim(),name=el('inputNama').value.trim(),chrono=el('inputKronologi').value.trim();
 if(!sku||!name||chrono.length<8)return notice('Form belum lengkap','SKU, produk dan kronologi minimal 8 karakter wajib diisi.','warning');
 const {data:{session},error:authError}=await sb.auth.getSession();if(authError||!session)return redirectLogin();
 const id=makeCaseId(),btn=el('btnSubmitLaporan');let saved=false;btn.disabled=true;btn.textContent='Menyimpan kasus...';
 try{
  const {error}=await sb.from('cases').insert([{id_kasus:id,id_pelapor:activeUser.id,sku_produk:sku,nama_produk:name,stok_sistem:sys,stok_fisik:fis,selisih:fis-sys,dugaan_penyebab:el('inputPenyebab').value,kronologi:chrono,status_kasus:'Baru Dilaporkan',source_intake_id:caseSourceIntake||null}]);
  if(error)throw new Error('Kasus gagal disimpan: '+error.message);
  saved=true;
  // Trigger database mencatat pembuatan laporan secara otomatis.
  const result=await uploadFiles(files,id,session,btn);
  el('formLaporanLengkap').reset();await loadCases({force:true});
  await notice(result.errors.length?'Sebagian bukti belum tersimpan':'Laporan berhasil',`Kasus ${id} tersimpan. ${result.count}/${files.length} bukti berhasil diunggah.${result.errors.length?' '+result.errors.join('; ')+' — Periksa Drive sebelum mengulangi unggah.':''}`,result.errors.length?'warning':'success');
  await openCase(id);
 }catch(e){await notice(saved?'Kasus tersimpan; bukti perlu dilengkapi':'Kasus belum disimpan',`${e.message}. ${saved?'ID kasus: '+id+'. Tambahkan bukti melalui Detail Kasus.':''}`,'error');if(saved){await loadCases({force:true});await openCase(id);}}
 finally{btn.disabled=false;btn.textContent='Kirim Laporan';}
}
async function addEvidenceToCase(ev){
 ev.preventDefault();if(!selectedCase||!activeUser)return notice('Pilih kasus','Buka detail kasus dahulu.','warning');
 const files=[...el('extraEvidenceFile').files];if(!validateFiles(files))return;
 const {data:{session},error:authErr}=await sb.auth.getSession();if(authErr||!session)return redirectLogin();
 const id=selectedCase.id_kasus,btn=el('btnExtraEvidence');btn.disabled=true;
 try{const r=await uploadFiles(files,id,session,btn);el('formExtraEvidence').reset();await Promise.all([loadEvidence(id),loadHistory(id)]);await notice(r.errors.length?'Upload sebagian':'Bukti berhasil ditambahkan',`${r.count}/${files.length} bukti tersimpan. ${r.errors.join('; ')} ${r.errors.length?'Periksa Drive sebelum unggah ulang.':''}`,r.errors.length?'warning':'success');}
 finally{btn.disabled=false;btn.textContent='Unggah bukti tambahan';}
}
async function downloadEvidence(id,fileId,filename){
 if(!fileId)return notice('File belum memiliki ID Drive','Periksa metadata bukti.','warning');
 const {data:{session},error:authError}=await sb.auth.getSession();if(authError||!session)return redirectLogin();
 try{
  const resp=await fetch('/api/evidence?case_id='+encodeURIComponent(id)+'&file_id='+encodeURIComponent(fileId),{headers:{Authorization:`Bearer ${session.access_token}`}});
  if(!resp.ok){const obj=await resp.json().catch(()=>({}));throw new Error(obj.error||`HTTP ${resp.status}`);}
  const data=await resp.blob();const u=URL.createObjectURL(data);const a=document.createElement('a');a.href=u;a.download=filename||'bukti';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);
 }catch(e){await notice('Download gagal',e.message,'error');}
}
async function loadArchive(){
 if(!activeUser)return;
 if(!canManageCases()){el('archiveNotice').textContent='Arsip & Sampah hanya dapat dibuka oleh Leader.';return;}
 el('archiveNotice').textContent='Memuat data yang diarsipkan...';
 try{
  const [casesRes,evidenceRes,intakesRes,intakeEvidenceRes,cashierRes]=await Promise.all([
   sb.from('cases').select('id_kasus,nama_produk,sku_produk,deleted_at,delete_reason,archive_batch_id').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(300),
   sb.from('evidence_files').select('id_file,id_kasus,nama_file_asli,drive_file_id,waktu_unggah,deleted_at,delete_reason,archive_batch_id').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(500),
   sb.from('stocktrace_intakes').select('id_intake,document_no,supplier,deleted_at,delete_reason,archive_batch_id').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(300),
   sb.from('stocktrace_intake_evidence').select('id_file,id_intake,nama_file_asli,drive_file_id,waktu_unggah,deleted_at,delete_reason,archive_batch_id').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(500),
   sb.from('stocktrace_cashier_requests').select('id_request,sku,product_name,status_request,deleted_at,delete_reason').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(300)
  ]);
  const firstError=[casesRes.error,evidenceRes.error,intakesRes.error,intakeEvidenceRes.error,cashierRes.error].find(Boolean);
  if(firstError)throw new Error(firstError.message);
  const cases=casesRes.data||[],intakes=intakesRes.data||[];
  const archivedCaseIds=new Set(cases.map(x=>String(x.id_kasus)));
  const archivedIntakeIds=new Set(intakes.map(x=>String(x.id_intake)));
  const rows=[
   ...cases.map(x=>({type:'case',id:x.id_kasus,label:'Laporan kasus',detail:`${x.sku_produk||''} · ${x.nama_produk||''}`,when:x.deleted_at,reason:x.delete_reason})),
   ...(evidenceRes.data||[]).filter(x=>!archivedCaseIds.has(String(x.id_kasus))).map(x=>({type:'evidence',id:x.id_file,label:'Bukti kasus',detail:`${x.id_kasus} · ${x.nama_file_asli}`,when:x.deleted_at,reason:x.delete_reason,download:{caseId:x.id_kasus,fileId:x.drive_file_id,name:x.nama_file_asli}})),
   ...intakes.map(x=>({type:'intake',id:x.id_intake,label:'Dokumen penerimaan',detail:`${x.document_no} · ${x.supplier}`,when:x.deleted_at,reason:x.delete_reason})),
   ...(intakeEvidenceRes.data||[]).filter(x=>!archivedIntakeIds.has(String(x.id_intake))).map(x=>({type:'intake_evidence',id:x.id_file,label:'Bukti penerimaan',detail:`${x.id_intake} · ${x.nama_file_asli}`,when:x.deleted_at,reason:x.delete_reason,download:{caseId:x.id_intake,fileId:x.drive_file_id,name:x.nama_file_asli}})),
   ...(cashierRes.data||[]).map(x=>({type:'cashier_request',id:x.id_request,label:'Permintaan kasir',detail:`${x.sku} · ${x.product_name} · ${x.status_request}`,when:x.deleted_at,reason:x.delete_reason}))
  ].sort((a,b)=>toText(b.when).localeCompare(toText(a.when)));
  el('archiveBody').innerHTML=rows.map(x=>`<tr class="border-b"><td class="py-3 pr-3">${htmlEscape(x.label)}</td><td class="py-3 pr-3 break-all"><strong>${htmlEscape(x.id)}</strong><span class="block text-xs text-slate-500">${htmlEscape(x.detail)}</span></td><td class="py-3 pr-3 whitespace-nowrap">${htmlEscape(niceDate(x.when))}</td><td class="py-3 pr-3">${htmlEscape(x.reason||'—')}</td><td class="py-3"><div class="flex flex-wrap gap-3">${x.download?`<button type="button" class="text-blue-700 underline text-xs" data-download-case="${htmlEscape(x.download.caseId)}" data-download-id="${htmlEscape(x.download.fileId)}" data-download-name="${htmlEscape(x.download.name)}">Unduh</button>`:''}<button type="button" class="st-restore-action" data-restore-type="${htmlEscape(x.type)}" data-restore-id="${htmlEscape(x.id)}">Pulihkan</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="py-6 text-center text-slate-500">Belum ada data di Arsip & Sampah.</td></tr>';
  el('archiveNotice').textContent='';
 }catch(error){
  console.error('StockTrace archive load failed:',error);
  el('archiveNotice').textContent='Gagal memuat arsip. Coba lagi.';
 }
}

async function askArchiveReason(action,label){
 const title=action==='restore'?'Pulihkan '+label:'Arsipkan '+label;
 if(window.Swal?.fire){
  const result=await window.Swal.fire({
   title,input:'textarea',inputLabel:action==='restore'?'Alasan pemulihan':'Alasan pengarsipan',
   inputPlaceholder:action==='restore'?'Contoh: Salah arsip, data perlu digunakan kembali...':'Contoh: Data duplikat atau salah input...',
   inputAttributes:{'aria-label':'Alasan tindakan',maxlength:500},
   showCancelButton:true,confirmButtonText:action==='restore'?'Pulihkan':'Arsipkan',
   cancelButtonText:'Batal',confirmButtonColor:action==='restore'?'#1D4ED8':'#475569',
   preConfirm:value=>{const text=String(value||'').trim();if(text.length<8){window.Swal.showValidationMessage('Alasan minimal 8 karakter.');return false;}return text;}
  });
  return result.isConfirmed?String(result.value||'').trim():null;
 }
 const value=window.prompt(title+' — alasan minimal 8 karakter:');
 return value&&value.trim().length>=8?value.trim():null;
}
async function archiveRecord(type,id){
 if(!activeUser||!id)return;
 const label=({case:'laporan kasus',evidence:'bukti kasus',intake:'dokumen penerimaan',intake_evidence:'bukti penerimaan',cashier_request:'permintaan kasir'})[type]||'data';
 const reason=await askArchiveReason('archive',label);if(!reason)return;
 try{
  const {data,error}=await sb.rpc('stocktrace_archive_record',{p_entity_type:type,p_entity_id:String(id),p_reason:reason});
  if(error)throw new Error(error.message);if(!data?.ok)throw new Error(data?.message||'Database belum mengonfirmasi pengarsipan.');
  await Promise.all([loadCases({force:true}),loadIntakesSafe(),loadCashierSafe()]);
  if(type==='case'&&selectedCase?.id_kasus===id){selectedCase=null;showView('cases');}
  else if(type==='evidence'&&selectedCase)await loadEvidence(selectedCase.id_kasus);
  else if(type==='intake')await loadIntakes({force:true});
  else if(type==='intake_evidence')await loadIntakes({force:true});
  else if(type==='cashier_request'){v21SelectedCashier=null;el('cashierDetail').replaceChildren();if(el('caseCorrectionDetail').contains(el('cashierDetail'))&&selectedCase)await openCase(selectedCase.id_kasus);else await loadCashier({force:true});}
  if(canManageCases())await loadArchive();
  await notice('Berhasil diarsipkan',`${label} berhasil diarsipkan.`,'success');
 }catch(error){await notice('Pengarsipan gagal',error.message,'error');}
}
async function restoreArchiveRecord(type,id){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader dapat memulihkan data.','warning');
 const label=({case:'laporan kasus',evidence:'bukti kasus',intake:'dokumen penerimaan',intake_evidence:'bukti penerimaan',cashier_request:'permintaan kasir'})[type]||'data';
 const reason=await askArchiveReason('restore',label);if(!reason)return;
 try{
  const {data,error}=await sb.rpc('stocktrace_restore_record',{p_entity_type:type,p_entity_id:String(id),p_reason:reason});
  if(error)throw new Error(error.message);if(!data?.ok)throw new Error(data?.message||'Database belum mengonfirmasi pemulihan.');
  await Promise.all([loadCases({force:true}),loadIntakesSafe(),loadCashierSafe(),loadArchive()]);
  await notice('Berhasil dipulihkan',`${label} kembali tersedia.`, 'success');
 }catch(error){await notice('Pemulihan gagal',error.message,'error');}
}
async function loadIntakesSafe(){if(typeof loadIntakes==='function')await loadIntakes({force:true});}
async function loadCashierSafe(){if(typeof loadCashier==='function')await loadCashier({force:true});}
async function archiveCurrentCase(){if(selectedCase)await archiveRecord('case',selectedCase.id_kasus);}


function selectedReportCases(){const from=el('reportFrom').value,to=el('reportTo').value;return cachedCases.filter(c=>{const day=toText(c.created_at).slice(0,10);return (!from||(day&&day>=from))&&(!to||(day&&day<=to));});}
function reportBars(id,items,total){el(id).innerHTML=items.length?items.map(([label,n])=>`<div><div class="flex gap-2 justify-between text-sm"><span>${htmlEscape(label)}</span><strong>${n}</strong></div><div class="bg-slate-100 rounded-full overflow-hidden"><div class="bar" style="width:${total?Math.max(2,Math.round(100*n/total)):0}%"></div></div></div>`).join(''):'<p class="text-slate-400">Tidak ada data</p>';}
function renderReports(){const data=selectedReportCases();reportBars('reportStatusBars',statuses.map(s=>[s,data.filter(c=>(c.status_kasus||statuses[0])===s).length]),data.length);const map=new Map();data.forEach(c=>{const s=toText(c.sku_produk)||'(tanpa SKU)';map.set(s,(map.get(s)||0)+1);});reportBars('reportSkuBars',[...map].sort((a,b)=>b[1]-a[1]).slice(0,8),data.length);}
function clearReportDates(){el('reportFrom').value='';el('reportTo').value='';renderReports();}
function csv(v){let s=toText(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportCasesCSV(){const header=['ID Kasus','Tanggal','SKU','Produk','Stok Sistem','Stok Fisik','Selisih','Dugaan Penyebab','Kronologi','Status','Pelapor','PIC','Waktu Penugasan PIC'];const rows=selectedReportCases().map(c=>[c.id_kasus,c.created_at,c.sku_produk,c.nama_produk,c.stok_sistem,c.stok_fisik,c.selisih,c.dugaan_penyebab,c.kronologi,c.status_kasus,displayPerson(c.id_pelapor),c.pic_nama||'',c.pic_ditetapkan_pada?niceDate(c.pic_ditetapkan_pada):'']);const text='\uFEFF'+[header,...rows].map(row=>row.map(csv).join(',')).join('\r\n');const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='StockTrace_Rekap_'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
function downloadClick(ev){const btn=ev.target.closest('button[data-download-id]');if(btn)downloadEvidence(btn.dataset.downloadCase,btn.dataset.downloadId,btn.dataset.downloadName);}

async function submitPasswordChange(ev){
 ev.preventDefault();
 const form=el('passwordChangeForm'),button=el('savePasswordButton');
 const current=el('currentPassword').value,newPass=el('newPassword').value,confirm=el('confirmPassword').value;
 if(!current)return notice('Belum lengkap','Isi kata sandi yang sekarang.','warning');
 if(newPass.length<12||newPass.length>128)return notice('Kata sandi belum memenuhi syarat','Gunakan minimal 12 karakter.','warning');
 if(newPass!==confirm)return notice('Konfirmasi tidak cocok','Ulangi kata sandi baru.','warning');
 if(newPass===current)return notice('Tidak boleh sama','Gunakan kata sandi baru yang berbeda.','warning');
 button.disabled=true;button.textContent='Memperbarui...';
 try{
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw new Error('Sesi berakhir. Login ulang.');
  const response=await fetch('/api/account-password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({current_password:current,new_password:newPass})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Gagal memperbarui kata sandi.');
  form.reset();mustChangePassword=false;document.body.classList.remove('st-password-required');
  await notice('Kata sandi diperbarui','Kata sandi berhasil diperbarui. Silakan login kembali.','success');
  await logout();
 }catch(e){await notice('Gagal mengganti kata sandi','Periksa kata sandi saat ini atau pengaturan verifikasi Supabase: '+e.message,'error');}
 finally{button.disabled=false;button.textContent='Ganti Kata Sandi';}
}

el('formLaporanLengkap').addEventListener('submit',submitReport);
el('formExtraEvidence').addEventListener('submit',addEvidenceToCase);
el('btnCaseSourceIntake').addEventListener('click',async()=>{const id=selectedCase?.source_intake_id;if(!id)return;showView('intake');await loadIntakes({force:true});v21OpenIntake(id,{scroll:true});});
el('searchCases').addEventListener('input',()=>{if(el('searchCases').value.trim()&&!el('view-cases').classList.contains('block'))showView('cases');displayCases();});
el('filterCaseStatus').addEventListener('change',displayCases);
el('filterCasePIC').addEventListener('change',displayCases);
el('dashboardCasesBody').addEventListener('click',e=>{const btn=e.target.closest('button[data-case-id]');if(btn)openCase(btn.dataset.caseId);});
el('detailEvidence').addEventListener('click',downloadClick);
el('archiveBody').addEventListener('click',e=>{
 const restore=e.target.closest('button[data-restore-type]');
 if(restore){restoreArchiveRecord(restore.dataset.restoreType,restore.dataset.restoreId);return;}
 downloadClick(e);
});
el('detailEvidence').addEventListener('click',e=>{
 const archive=e.target.closest('button[data-archive-record]');
 if(archive)archiveRecord(archive.dataset.archiveRecord,archive.dataset.archiveId);
});
el('passwordChangeForm').addEventListener('submit',submitPasswordChange);
async function bootstrap(){
 try{
  const response=await fetch('/api/public-config');
  const settings=await response.json().catch(()=>({}));
  if(!response.ok||!settings.supabase_url||!settings.supabase_publishable_key)throw new Error(settings.error||'Konfigurasi publik tidak siap.');
  if(!window.supabase?.createClient)throw new Error('Library Supabase tidak dapat dimuat.');
   try{const projectRef=new URL(settings.supabase_url).hostname.split('.')[0];localStorage.removeItem(`sb-${projectRef}-auth-token`);localStorage.removeItem('user_role');localStorage.removeItem('user_name');}catch(_){}
   sb=window.supabase.createClient(settings.supabase_url,settings.supabase_publishable_key,{
    auth:{storage:window.sessionStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
   });
  await checkAuth();
 }catch(e){
  activeUser=null;activeRole='Staff';mustChangePassword=false;
  console.error('StockTrace bootstrap failed:',e);
  showAuthBootError(e.message||'Aplikasi belum siap. Periksa koneksi lalu coba lagi.');
 }
}
bootstrap();
;

// --- v21.js ---
/* StockTrace V2.1 — separate academic intake & cashier request workflows.
 * Depends on app.js, xlsx-export.js; uses existing Supabase session and Drive control.
 * No official inventory/cashier integration and never mutates official stock quantities.
 */
let v21Intakes=[],v21Items=[],v21IntakeEvidence=[],v21Cashier=[],v21SelectedIntake=null,v21SelectedCashier=null;
let v21IntakesLoadedAt=0,v21CashierLoadedAt=0,v21IntakesPromise=null,v21CashierPromise=null;
const cashierStatuses=['Diajukan','Diteruskan ke Kasir','Sedang Diproses','Selesai (Dikonfirmasi)','Ditolak'];
const v21Int=id=>{const v=Number(id.value);return id.value!==''&&Number.isSafeInteger(v)&&v>=0&&v<=999999999?v:null;};
function v21DateBalikpapan(){const ps=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${ps.year}-${ps.month}-${ps.day}`;}
function v21Row(){
 const tr=document.createElement('tr');tr.innerHTML=`<td><input aria-label="SKU" data-field="sku" class="st-field" maxlength="80" required placeholder="NP-..."/><button type="button" class="st-secondary-btn" data-find-intake-sku="1">Cari kode</button></td>
 <td><input aria-label="Nama produk" data-field="product_name" class="st-field" maxlength="150" readonly required placeholder="Nama barang"/></td>
 <td><input aria-label="Jumlah sesuai dokumen" data-field="qty_document" type="number" class="st-field" min="0" max="999999999" step="1" value="0" required/></td>
 <td><input aria-label="Jumlah barang datang termasuk reject" data-field="qty_received" type="number" class="st-field" min="0" max="999999999" step="1" value="0" required/></td>
 <td><input aria-label="Jumlah barang reject" data-field="qty_rejected" type="number" class="st-field" min="0" max="999999999" step="1" value="0" required/></td>
 <td><strong data-field="qty_accepted" class="text-emerald-700">0</strong></td>
 <td><strong data-field="accepted_difference" class="text-slate-700">0</strong></td>
 <td><input aria-label="Alasan barang reject" data-field="reject_reason" class="st-field" maxlength="1000" placeholder="Alasan reject"/></td>
 <td><strong data-field="difference" class="text-slate-700">0</strong></td><td><button type="button" class="st-inline-action" data-remove-row="1">Hapus</button></td>`;
 el('intakeItemsBody').appendChild(tr);return tr;
}
function v21UpdateRowDiff(row){
 const doc=v21Int(row.querySelector('[data-field="qty_document"]'));
 const received=v21Int(row.querySelector('[data-field="qty_received"]'));
 const rejected=v21Int(row.querySelector('[data-field="qty_rejected"]'));
 const accepted=row.querySelector('[data-field="qty_accepted"]');
 const acceptedDifference=row.querySelector('[data-field="accepted_difference"]');
 const invalid=rejected===null||received===null||rejected>received;
 accepted.textContent=invalid?'—':String(received-rejected);
 acceptedDifference.textContent=invalid||doc===null?'—':String((received-rejected)-doc);
 accepted.classList.toggle('text-red-600',invalid);
 accepted.classList.toggle('text-emerald-700',!invalid);
 row.querySelector('[data-field="difference"]').textContent=doc===null||received===null?'—':String(received-doc);
 row.querySelector('[data-field="qty_rejected"]').setCustomValidity(invalid?'Jumlah reject tidak boleh melebihi jumlah fisik datang.':'');
}
async function findIntakeSku(button){
 const row=button.closest('tr'),sku=row.querySelector('[data-field="sku"]'),name=row.querySelector('[data-field="product_name"]'),code=sku.value.trim();
 if(!code)return notice('Kode produk','Masukkan SKU atau kode terlebih dahulu.','warning');
 if(button.disabled)return;const oldName=name.value;button.disabled=true;
 try{const p=await retailFindCode(code);if(!row.isConnected||sku.value.trim()!==code||name.value!==oldName)return;
  if(!p){if(el('retailProductDialog').open)return;retailOpenProduct(null,code,'intake-register');retailRegistrationRow=row;el('retailEditSku').value=code.toUpperCase();return;}
  if([...el('intakeItemsBody').rows].some(r=>r!==row&&r.querySelector('[data-field="sku"]').value.trim().toUpperCase()===p.sku.toUpperCase()))return notice('SKU sudah ada','Gunakan baris produk yang sudah ada.','warning');
  sku.value=p.sku;name.value=p.name;
 }catch(e){await notice('Pencarian gagal',e.message,'error');}finally{button.disabled=false;}
}
function v21CollectRows(){
 const rows=[...el('intakeItemsBody').rows].map(row=>({
  sku:row.querySelector('[data-field="sku"]').value.trim(),
  product_name:row.querySelector('[data-field="product_name"]').value.trim(),
  qty_document:v21Int(row.querySelector('[data-field="qty_document"]')),
  qty_received:v21Int(row.querySelector('[data-field="qty_received"]')),
  qty_rejected:v21Int(row.querySelector('[data-field="qty_rejected"]')),
  reject_reason:row.querySelector('[data-field="reject_reason"]').value.trim()
 }));
 if(!rows.length||rows.length>150)throw Error('Isi minimal 1, maksimal 150 SKU.');
 const keys=new Set();
 for(const r of rows){
  const key=r.sku.toUpperCase();
  if(!r.sku||r.sku.length>80||r.product_name.length<2||r.qty_document===null||r.qty_received===null||r.qty_rejected===null)
   throw Error('Lengkapi SKU, nama produk, jumlah dokumen, jumlah fisik, dan jumlah reject yang valid.');
  if(r.qty_rejected>r.qty_received)throw Error(`Jumlah reject SKU ${r.sku} melebihi jumlah fisik yang datang.`);
  if(r.qty_rejected>0&&r.reject_reason.length<3)throw Error(`Isi alasan reject minimal 3 karakter untuk SKU ${r.sku}.`);
  if(r.reject_reason.length>1000)throw Error(`Alasan reject SKU ${r.sku} maksimal 1.000 karakter.`);
  if(keys.has(key))throw Error('SKU duplikat pada satu dokumen: '+r.sku+'. Gabungkan ke satu baris.');
  keys.add(key);
 }
 return rows;
}
async function v21ReadPaged(table,sortKey='created_at',max=5000,columns='*'){
 const rows=[],batch=1000;
 for(let start=0;start<max;start+=batch){
  const {data,error}=await sb.from(table).select(columns).is('deleted_at',null).order(sortKey,{ascending:false}).range(start,start+batch-1);
  if(error)throw Error('Gagal memuat '+table+': '+error.message);
  rows.push(...(data||[]));if(!data||data.length<batch)break;
 }
 return {rows,truncated:rows.length===max};
}
async function loadIntakes(options={}){
 if(!activeUser||mustChangePassword)return;
 const force=options?.force===true;
 if(!force&&v21IntakesLoadedAt&&Date.now()-v21IntakesLoadedAt<15000){
  v21RenderIntakes();if(v21SelectedIntake)v21OpenIntake(v21SelectedIntake);return;
 }
 if(v21IntakesPromise)return v21IntakesPromise;
 const task=(async()=>{
  el('intakeNotice').textContent='Memuat penerimaan & rincian...';
  try{
   const [headers,items,evid]=await Promise.all([
    v21ReadPaged('stocktrace_intakes','created_at',5000,'id_intake,document_no,received_on,supplier,note,created_by,created_at,deleted_at'),
    v21ReadPaged('stocktrace_intake_items','id_intake',5000,'id_intake,sku,product_name,qty_document,qty_received,qty_difference,qty_rejected,qty_accepted,qty_accepted_difference,reject_reason,deleted_at'),
    v21ReadPaged('stocktrace_intake_evidence','waktu_unggah',5000,'id_file,id_intake,nama_file_asli,drive_file_id,drive_view_url,evidence_type,uploaded_by,waktu_unggah,deleted_at')
   ]);
   v21Intakes=headers.rows;v21Items=items.rows;v21IntakeEvidence=evid.rows;v21IntakesLoadedAt=Date.now();
   v21RenderIntakes();el('intakeNotice').textContent='';
   if(v21SelectedIntake)v21OpenIntake(v21SelectedIntake);
  }catch(e){el('intakeNotice').textContent='Gagal memuat penerimaan: '+e.message;}
 })();
 v21IntakesPromise=task;
 try{return await task;}finally{if(v21IntakesPromise===task)v21IntakesPromise=null;}
}
function v21RenderIntakes(){
 const itemsByIntake=new Map();
 for(const item of v21Items){
  const key=String(item.id_intake);
  if(!itemsByIntake.has(key))itemsByIntake.set(key,[]);
  itemsByIntake.get(key).push(item);
 }
 const html=v21Intakes.map(h=>{
  const list=itemsByIntake.get(String(h.id_intake))||[];
  const diff=list.filter(x=>x.qty_difference!==0).length;
  const count=list.reduce((sum,x)=>sum+Math.abs(x.qty_difference||0),0);
  const rejected=list.reduce((sum,x)=>sum+Number(x.qty_rejected||0),0);
  return `<tr><td><strong>${htmlEscape(h.id_intake)}</strong><div class="text-xs text-slate-500">${htmlEscape(h.received_on)}</div></td>
   <td>${htmlEscape(h.document_no)}<div class="text-xs text-slate-500">${htmlEscape(h.supplier)}</div></td>
   <td>${list.length} SKU</td><td>${diff} SKU (total absolut ${count})</td><td><strong>${rejected}</strong></td><td>${htmlEscape(displayPerson(h.created_by))}</td>
   <td><button type="button" class="st-inline-action st-open-detail-action" data-open-intake="${htmlEscape(h.id_intake)}" aria-label="Buka rincian penerimaan ${htmlEscape(h.id_intake)}">Buka</button></td></tr>`;
 }).join('');
 const tbody=el('intakesBody');
 tbody.innerHTML=html||'<tr><td colspan="7" class="text-slate-500">Belum ada penerimaan.</td></tr>';
 // Bind directly to each generated action for reliable mobile taps.
 tbody.querySelectorAll('button[data-open-intake]').forEach(button=>{
  button.addEventListener('click',event=>{
   event.preventDefault();
   const id=button.getAttribute('data-open-intake');
   if(id)v21OpenIntake(id,{scroll:true});
  });
 });
}
function v21ScrollToDetail(id){
 const node=el(id);
 if(!node||!window.matchMedia?.('(max-width: 767px)').matches)return;
 const scroll=()=>{
  const scroller=document.querySelector('.st-main > .flex-1.overflow-y-auto');
  if(scroller&&scroller.contains(node)){
   const nodeTop=node.getBoundingClientRect().top;
   const scrollerTop=scroller.getBoundingClientRect().top;
   const nextTop=Math.max(0,scroller.scrollTop+nodeTop-scrollerTop-10);
   scroller.scrollTo({top:nextTop,behavior:'smooth'});
   return;
  }
  // Fallback only if a future view is rendered outside the main content pane.
  node.scrollIntoView({behavior:'smooth',block:'start'});
 };
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(scroll);else scroll();
}

function v21OpenIntake(id,options={}){
 const key=String(id??'');
 const h=v21Intakes.find(x=>String(x.id_intake)===key);
 if(!h){notice('Dokumen tidak ditemukan','Muat ulang daftar penerimaan, lalu coba buka kembali.','warning');return;}
 v21SelectedIntake=String(h.id_intake);
 const items=v21Items.filter(x=>String(x.id_intake)===key);const files=v21IntakeEvidence.filter(x=>String(x.id_intake)===key);
 const lines=items.map(x=>`<tr><td>${htmlEscape(x.sku)}</td><td>${htmlEscape(x.product_name)}</td><td>${x.qty_document}</td><td>${x.qty_received}</td><td>${Number(x.qty_rejected||0)}</td><td><strong class="text-emerald-700">${Number(x.qty_accepted??(x.qty_received-(x.qty_rejected||0)))}</strong></td><td><strong>${Number(x.qty_accepted_difference??((x.qty_received-(x.qty_rejected||0))-x.qty_document))>0?'+':''}${Number(x.qty_accepted_difference??((x.qty_received-(x.qty_rejected||0))-x.qty_document))}</strong></td><td>${htmlEscape(x.reject_reason||'—')}</td><td><strong>${x.qty_difference>0?'+':''}${x.qty_difference}</strong></td><td><button type="button" class="st-secondary-btn" data-intake-correction="${htmlEscape(x.sku)}">Periksa stok</button></td></tr>`).join('');
 const links=files.map(f=>`<div class="text-xs py-2 border-b flex justify-between gap-3 flex-wrap"><span class="break-all"><strong>${htmlEscape(f.evidence_type||'Bukti Penerimaan')}</strong> · ${htmlEscape(f.nama_file_asli)} · ${htmlEscape(niceDate(f.waktu_unggah))}</span><span class="flex gap-3"><button type="button" class="st-inline-action" data-download-case="${htmlEscape(key)}" data-download-id="${htmlEscape(f.drive_file_id)}" data-download-name="${htmlEscape(f.nama_file_asli)}">Unduh</button>${canManageCases()?`<button type="button" class="st-archive-action" data-archive-record="intake_evidence" data-archive-id="${htmlEscape(f.id_file)}">Arsipkan</button>`:''}</span></div>`).join('');
 el('intakeDetail').innerHTML=`<div class="st-detail-box space-y-3"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">Rincian ${htmlEscape(key)}</h3><button type="button" class="st-inline-action" data-close-intake="1">Tutup</button></div>
 <p class="text-xs">Dokumen: <strong>${htmlEscape(h.document_no)}</strong> · Tanggal: ${htmlEscape(h.received_on)} · Pengirim: ${htmlEscape(h.supplier)} · Dicatat: ${htmlEscape(niceDate(h.created_at))}</p>
 <p class="text-xs whitespace-pre-wrap">Catatan: ${htmlEscape(h.note||'—')}</p><div class="st-data-table overflow-x-auto"><table class="st-entry-table w-full text-sm"><thead><tr><th>SKU</th><th>Produk</th><th>Jumlah sesuai dokumen</th><th>Jumlah barang datang</th><th>Barang reject</th><th>Diterima (layak jual)</th><th>Selisih layak vs dokumen</th><th>Alasan reject</th><th>Selisih datang vs dokumen</th><th>Aksi</th></tr></thead><tbody>${lines}</tbody></table></div>
 <h4 class="font-semibold text-sm">Bukti penerimaan & barang reject (${files.length})</h4>${links||'<p class="text-xs text-slate-500">Belum ada lampiran.</p>'}
 <div class="border-t pt-3 space-y-2"><label class="st-field-label" for="intakeDetailEvidenceType">Jenis bukti</label><select id="intakeDetailEvidenceType" class="st-field"><option value="Bukti Penerimaan">Bukti Penerimaan</option><option value="Bukti Barang Reject">Bukti Barang Reject</option></select><label class="st-field-label" for="intakeDetailFiles">Lampiran tambahan</label><input id="intakeDetailFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.mp4,.webm,.doc,.docx,.xls,.xlsx,.csv,.txt" class="st-field"/><p id="intakeDetailProgress" class="text-xs text-blue-700" role="status" aria-live="polite"></p><button type="button" class="st-secondary-btn" data-upload-intake="${htmlEscape(key)}">Unggah lampiran</button></div>
  <div class="flex flex-wrap gap-2">${canManageCases()?`<button type="button" class="st-archive-action" data-archive-intake="${htmlEscape(key)}">Arsipkan dokumen</button>`:''}</div></div>`;
 if(options.scroll)v21ScrollToDetail('intakeDetail');
}
async function v21AttachFiles(files,id,progress,evidenceType='Bukti Penerimaan'){
 if(!files.length)return {count:0,errors:[]};
 if(!validateFiles(files))throw Error('Pemeriksaan berkas gagal.');
 if(!['Bukti Penerimaan','Bukti Barang Reject'].includes(evidenceType))throw Error('Jenis bukti tidak valid.');
 const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error('Sesi login berakhir.');
 return uploadFileBatch(files,id,session,progress,{table:'stocktrace_intake_evidence',idField:'id_intake',extraFields:{evidence_type:evidenceType}});
}
let intakeRequestKey=null;
async function v21SaveIntake(event){
 event.preventDefault();if(!activeUser||mustChangePassword)return;
 let items;try{items=v21CollectRows();}catch(e){return notice('Rincian belum lengkap',e.message,'warning');}
 const date=el('intakeDate').value,document_no=el('intakeDoc').value.trim(),supplier=el('intakeSupplier').value.trim(),note=el('intakeNote').value.trim();
 if(document_no.length<2||supplier.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(date))return notice('Data dokumen belum lengkap','Isi nomor dokumen, tanggal dan sumber barang.','warning');
 const files=[...el('intakeFile').files],evidenceType=el('intakeEvidenceType').value;if(files.length&&!validateFiles(files))return;
 const button=el('btnSaveIntake');if(button.disabled)return;button.disabled=true;button.textContent='Menyimpan...';let savedId=null;
 try{
  intakeRequestKey ||= crypto.randomUUID();
  const {data,error}=await sb.rpc('st_create_intake_once',{p_request_key:intakeRequestKey,p_document_no:document_no,p_received_on:date,p_supplier:supplier,p_note:note,p_items:items});
  if(error)throw Error(error.message);if(!data?.ok||!data.id_intake)throw Error('Penerimaan belum dikonfirmasi database.');
  const id=data.id_intake;savedId=id;
  // The document is committed atomically BEFORE optional media upload. Failure cannot erase document.
  let upload={count:0,errors:[]};if(files.length&&!data.replayed){try{upload=await v21AttachFiles(files,id,el('intakeUploadProgress'),evidenceType);}catch(e){upload.errors.push(e.message);}}else if(files.length&&data.replayed){upload.errors.push('Penerimaan sudah tercatat. Periksa lampiran sebelum mengunggah ulang.');}
  intakeRequestKey=null;el('formIntake').reset();el('intakeItemsBody').replaceChildren();v21Row();el('intakeDate').value=v21DateBalikpapan();
  await loadIntakes({force:true});v21OpenIntake(id);
  await notice(upload.errors.length?'Dokumen tersimpan, sebagian bukti gagal':'Penerimaan tersimpan',`ID ${id}. ${items.length} SKU. ${files.length?`Lampiran ${upload.count}/${files.length}.`:''} ${upload.errors.join('; ')} ${upload.errors.length?'Periksa Drive sebelum mencoba ulang.':''}`,upload.errors.length?'warning':'success');
 }catch(e){await notice(savedId?'Penerimaan sudah tersimpan':'Gagal menyimpan penerimaan',savedId?`ID ${savedId}. Periksa riwayat dan lampiran. ${e.message}`:`${e.message}. Jika koneksi terputus, kirim ulang formulir yang sama tanpa mengubah isinya.`,savedId?'warning':'error');}
 finally{button.disabled=false;button.textContent='Simpan penerimaan';}
}
function v21Export(){
 if(!v21Intakes.length&&!v21Cashier.length)return notice('Belum ada data','Buka penerimaan dan kasir, kemudian muat data terlebih dahulu.','warning');
 if(!globalThis.StockTraceXlsx?.save)return notice('Ekspor belum siap','Modul XLSX tidak termuat.','error');
 const intakeIds=new Set(v21Intakes.map(h=>String(h.id_intake)));
 const details=v21Items.filter(x=>intakeIds.has(String(x.id_intake)));
 const sheets=[
  {name:'Penerimaan',rows:[['ID Penerimaan','No Dokumen','Tanggal Terima','Pengirim','Catatan','Pembuat','Waktu Dibuat','Total Barang Reject'],...v21Intakes.map(h=>[h.id_intake,h.document_no,h.received_on,h.supplier,h.note,displayPerson(h.created_by),niceDate(h.created_at),details.filter(i=>String(i.id_intake)===String(h.id_intake)).reduce((sum,i)=>sum+Number(i.qty_rejected||0),0)])]},
  {name:'Detail SKU',rows:[['ID Penerimaan','SKU','Nama Produk','Jumlah sesuai dokumen','Jumlah barang datang','Jumlah reject','Diterima (layak jual)','Selisih layak vs dokumen','Alasan Reject','Selisih datang vs dokumen','Hasil Layak'],...details.map(i=>[i.id_intake,i.sku,i.product_name,i.qty_document,i.qty_received,Number(i.qty_rejected||0),Number(i.qty_accepted??(i.qty_received-(i.qty_rejected||0))),Number(i.qty_accepted_difference??((i.qty_received-(i.qty_rejected||0))-i.qty_document)),i.reject_reason||'',i.qty_difference,Number(i.qty_accepted_difference??((i.qty_received-(i.qty_rejected||0))-i.qty_document))===0?'Sesuai':Number(i.qty_accepted_difference??((i.qty_received-(i.qty_rejected||0))-i.qty_document))<0?'Kurang':'Lebih'])]},
  {name:'Bukti Penerimaan',rows:[['ID Penerimaan','Jenis Bukti','Nama Berkas','Google Drive File ID','Google Drive URL','Pengunggah','Waktu Unggah'],...v21IntakeEvidence.filter(f=>intakeIds.has(String(f.id_intake))).map(f=>[f.id_intake,f.evidence_type||'Bukti Penerimaan',f.nama_file_asli,f.drive_file_id,f.drive_view_url||'',displayPerson(f.uploaded_by),niceDate(f.waktu_unggah)])]},
  {name:'Permintaan Kasir',rows:[['ID Permintaan','SKU','Nama Produk','Stok sistem','Stok fisik','Selisih','Alasan','Status','Laporan terkait','ID Penerimaan','Pemohon','Dibuat','Pembaruan'],...v21Cashier.map(r=>[r.id_request,r.sku,r.product_name,r.qty_system,r.qty_physical,r.qty_difference,r.reason,r.status_request,r.id_kasus||'',r.id_intake||'',displayPerson(r.created_by),niceDate(r.created_at),niceDate(r.updated_at)])]},
  {name:'Keterangan',rows:[['Keterangan'],['Selisih = jumlah fisik datang termasuk reject - jumlah dokumen.'],['Diterima layak = jumlah fisik datang - jumlah barang reject.'],['Selisih layak = jumlah diterima layak - jumlah dokumen.'],['Selisih fisik tetap membandingkan seluruh barang datang dengan dokumen.'],['Barang reject dicatat per SKU dan dilengkapi alasan.'],['Update stok kasir tetap dilakukan di sistem kasir.'],['Dibuat (WITA)',niceDate(new Date().toISOString())]]}
 ];
 try{StockTraceXlsx.save(sheets,'StockTrace_Penerimaan_Kasir_'+v21DateBalikpapan()+'.xlsx');}
 catch(e){notice('Ekspor XLSX gagal',e.message,'error');}
}
async function loadCashier(options={}){
 if(!activeUser||mustChangePassword)return;
 const force=options?.force===true;
 if(!force&&v21CashierLoadedAt&&Date.now()-v21CashierLoadedAt<15000){
  v21RenderCashier();if(v21SelectedCashier)await v21OpenCashier(v21SelectedCashier);return;
 }
 if(v21CashierPromise)return v21CashierPromise;
 const task=(async()=>{
  el('cashierNotice').textContent='Memuat permintaan update stok...';
  try{
   const data=await v21ReadPaged('stocktrace_cashier_requests','created_at',5000,'id_request,sku,product_name,qty_system,qty_physical,qty_difference,reason,status_request,id_kasus,id_intake,created_by,created_at,updated_at,deleted_at');
   v21Cashier=data.rows;v21CashierLoadedAt=Date.now();v21RenderCashier();
   el('cashierNotice').textContent='';
   if(v21SelectedCashier)await v21OpenCashier(v21SelectedCashier);
  }catch(e){el('cashierNotice').textContent='Gagal memuat permintaan: '+e.message;}
 })();
 v21CashierPromise=task;
 try{return await task;}finally{if(v21CashierPromise===task)v21CashierPromise=null;}
}
function v21RenderCashier(){
 const f=el('cashierFilter').value,list=v21Cashier.filter(r=>!f||r.status_request===f);
 el('cashierTotal').textContent=v21Cashier.length;
 el('cashierWaiting').textContent=v21Cashier.filter(x=>['Diajukan','Diteruskan ke Kasir'].includes(x.status_request)).length;
 el('cashierProcess').textContent=v21Cashier.filter(x=>x.status_request==='Sedang Diproses').length;
 el('cashierDone').textContent=v21Cashier.filter(x=>x.status_request==='Selesai (Dikonfirmasi)').length;
 const tbody=el('cashierBody');
 tbody.innerHTML=list.map(r=>`<tr><td><strong>${htmlEscape(r.id_request)}</strong><div class="text-xs text-slate-500">${htmlEscape(r.sku)} · ${htmlEscape(r.product_name)}</div></td><td>${r.qty_difference>0?'+':''}${r.qty_difference}</td><td><span class="status-chip">${htmlEscape(r.status_request)}</span></td><td>${htmlEscape(displayPerson(r.created_by))}</td><td>${htmlEscape(niceDate(r.created_at))}</td><td><button type="button" data-open-cashier="${htmlEscape(r.id_request)}" class="st-inline-action st-open-detail-action" aria-label="Buka detail permintaan ${htmlEscape(r.id_request)}">Detail</button></td></tr>`).join('')||'<tr><td colspan="6" class="text-slate-500">Belum ada permintaan untuk filter ini.</td></tr>';
 // Bind directly after rendering for reliable taps on mobile.
 tbody.querySelectorAll('button[data-open-cashier]').forEach(button=>{
  button.addEventListener('click',event=>{
   event.preventDefault();
   const id=button.getAttribute('data-open-cashier');
   if(id)v21OpenCashier(id,{scroll:true}).catch(error=>notice('Gagal membuka permintaan',error.message,'error'));
  });
 });
}

async function v21OpenCashier(id,options={}){
 const key=String(id??'');
 const r=options.record||v21Cashier.find(x=>String(x.id_request)===key);
 if(!r){notice('Permintaan tidak ditemukan','Muat ulang daftar permintaan, lalu coba buka kembali.','warning');return;}
 v21SelectedCashier=String(r.id_request);
 const host=el('cashierDetail').parentElement;
 const {data,error}=await sb.from('stocktrace_cashier_logs').select('action,note,id_user,created_at').eq('id_request',r.id_request).order('created_at',{ascending:false}).limit(150);
 if(v21SelectedCashier!==key||el('cashierDetail').parentElement!==host||(options.caseId&&selectedCase?.id_kasus!==options.caseId))return;
 const history=error?'<p class="text-xs text-red-700">Gagal membaca riwayat: '+htmlEscape(error.message)+'</p>':(data||[]).map(x=>`<div class="border-l-2 border-blue-300 pl-3 py-1 mb-3 text-xs"><strong>${htmlEscape(x.action)}</strong><p>${htmlEscape(niceDate(x.created_at))} · ${htmlEscape(displayPerson(x.id_user))}</p><p class="whitespace-pre-wrap">${htmlEscape(x.note)}</p></div>`).join('')||'<p class="text-xs">Belum ada riwayat.</p>';
  const canArchive=canManageCases()||(r.created_by===activeUser?.id&&r.status_request==='Diajukan');
  const archiveAction=canArchive?`<button type="button" class="st-archive-action" data-archive-cashier="${htmlEscape(r.id_request)}">Arsipkan permintaan</button>`:'';
 const management=canManageCases()&&openCorrectionStatuses.includes(r.status_request)?`<div class="border-t pt-3 space-y-2"><h4 class="font-semibold text-sm">Tindak lanjut Leader</h4><label class="st-field-label" for="cashierStatus">Ubah status monitoring</label><select id="cashierStatus" class="st-field">${cashierStatuses.map(s=>`<option ${s===r.status_request?'selected':''}>${htmlEscape(s)}</option>`).join('')}</select><label class="st-field-label" for="cashierStatusNote">Catatan wajib (minimal 8 karakter)</label><textarea id="cashierStatusNote" class="st-field" rows="3" maxlength="2000"></textarea><button type="button" class="st-primary-btn" data-save-cashier="${htmlEscape(r.id_request)}">Simpan status & riwayat</button></div>`:'';
 el('cashierDetail').innerHTML=`<div class="st-detail-box space-y-3"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">${htmlEscape(r.id_request)} — ${htmlEscape(r.sku)}</h3>${host.id==='caseCorrectionDetail'?'':'<button type="button" data-close-cashier="1" class="st-inline-action">Tutup</button>'}</div>
 <div class="text-xs grid grid-cols-1 md:grid-cols-2 gap-3"><p>Nama: ${htmlEscape(r.product_name)}<br>Kasir: ${r.qty_system} · Fisik: ${r.qty_physical} · Selisih: ${r.qty_difference}</p><p>Laporan terkait: ${htmlEscape(r.id_kasus||'—')}<br>Penerimaan: ${htmlEscape(r.id_intake||'—')}<br>Status: ${htmlEscape(r.status_request)}</p></div>
 ${r.id_kasus&&host.id!=='caseCorrectionDetail'?`<button type="button" class="st-secondary-btn" data-correction-case="${htmlEscape(r.id_kasus)}">Buka laporan</button>`:''}<p class="text-xs whitespace-pre-wrap">Alasan: ${htmlEscape(r.reason)}</p><h4 class="font-semibold text-sm">Riwayat permintaan</h4>${history}<div class="flex flex-wrap gap-2">${archiveAction}</div>${management}</div>`;
 if(options.scroll)v21ScrollToDetail('cashierDetail');
}
const openCorrectionStatuses=['Diajukan','Diteruskan ke Kasir','Sedang Diproses'];
async function findOpenCorrection(sku,caseId,intakeId){
 if(!caseId&&!intakeId)return null;
 for(const [column,id] of [['id_kasus',caseId],['id_intake',intakeId]]){
  if(!id)continue;
  const rows=await retailRead('stocktrace_cashier_requests','id_request,sku,status_request',q=>q.eq(column,id).is('deleted_at',null).in('status_request',openCorrectionStatuses).order('id_request'));
  const match=rows.find(r=>String(r.sku).trim().toUpperCase()===sku.trim().toUpperCase());if(match)return match;
 }
 return null;
}
let caseSourceIntake=null;
async function prepareStockCorrection(source){
 if(!activeUser||mustChangePassword)return;
 try{
  const p=await retailFindCode(source.sku);if(!p)throw Error('Produk belum terdaftar.');
  const existing=await retailRead('cases','id_kasus',q=>q.eq('source_intake_id',source.intake).eq('sku_produk',p.sku).is('deleted_at',null).neq('status_kasus','Selesai').order('created_at',{ascending:false}).order('id_kasus'));
  if(existing.length){await loadCases({force:true});await openCase(existing[0].id_kasus);return;}
  if((el('inputSKU').value.trim()||el('inputKronologi').value.trim()||el('inputFile').files.length)&&!window.confirm('Ganti pemeriksaan yang belum disimpan?'))return;
  showView('form-laporan');el('formLaporanLengkap').reset();await retailApplyProduct(p,'case');
  caseSourceIntake=source.intake;el('caseIntakeSource').textContent='Penerimaan: '+source.intake;el('caseIntakeSource').hidden=false;
  el('inputSKU').readOnly=true;el('retailTopScan').disabled=true;el('inputPenyebab').value='Selisih Dokumen Penerimaan';el('inputSistem').focus();
 }catch(e){await notice('Pemeriksaan belum dibuka',e.message,'error');}
}
el('btnCaseCorrection').addEventListener('click',async()=>{
 const c=selectedCase,btn=el('btnCaseCorrection');if(!c||btn.disabled)return;btn.disabled=true;
 try{
  const existing=await findOpenCorrection(c.sku_produk,c.id_kasus,null);
  if(existing){await loadLinkedCorrection(c.id_kasus);return;}
  if(c.status_kasus==='Selesai')return;
  const reason=await retailAskReason('Ajukan koreksi stok kasir?');if(!reason)return;
  const data=await retailRpc('stocktrace_request_cashier_update',{p_sku:c.sku_produk,p_product:c.nama_produk,p_system_qty:c.stok_sistem,p_counted_qty:c.stok_fisik,p_reason:reason,p_case_id:c.id_kasus,p_intake_id:null});
  if(!data?.ok)throw Error('Koreksi belum dikonfirmasi.');
  await loadCases({force:true});await openCase(c.id_kasus);await notice('Koreksi diajukan',data.id_request,'success');
 }catch(e){await notice('Koreksi belum disimpan',e.message,'error');}finally{btn.disabled=false;}
});
async function loadLinkedCorrection(id){
 const status=el('caseCorrectionStatus'),btn=el('btnCaseCorrection');status.textContent='';btn.disabled=true;
 try{
  const rows=await retailRead('stocktrace_cashier_requests','*',q=>q.eq('id_kasus',id).is('deleted_at',null).order('created_at',{ascending:false}).order('id_request'));
  if(selectedCase?.id_kasus!==id||!el('view-detail-kasus').classList.contains('block'))return;
  const active=rows.find(x=>openCorrectionStatuses.includes(x.status_request)),confirmed=rows.find(x=>x.status_request==='Selesai (Dikonfirmasi)'),latest=active||confirmed||rows[0];
  status.textContent=latest?'Koreksi kasir: '+latest.status_request+' · '+latest.id_request:'';
  btn.textContent='Ajukan koreksi stok kasir';btn.hidden=!!active||!!confirmed||selectedCase.status_kasus==='Selesai';btn.disabled=false;
  if(latest&&selectedCase?.id_kasus===id&&el('view-detail-kasus').classList.contains('block')&&el('caseCorrectionDetail').contains(el('cashierDetail')))await v21OpenCashier(latest.id_request,{caseId:id,record:latest});
 }catch(e){if(selectedCase?.id_kasus===id){status.textContent='Status koreksi tidak dapat dimuat: '+e.message;btn.hidden=true;}}
}
async function v21UpdateCashier(id){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader.','warning');
 const status=el('cashierStatus').value,note=el('cashierStatusNote').value.trim();
 if(!cashierStatuses.includes(status)||note.length<8)return notice('Catatan wajib','Isi minimal 8 karakter sebelum memperbarui status.','warning');
 const btn=el('cashierDetail').querySelector('[data-save-cashier]');btn.disabled=true;
 try{
  const {data,error}=await sb.rpc('stocktrace_update_cashier_status',{p_request_id:id,p_status:status,p_note:note});
  if(error)throw Error(error.message);if(!data?.ok)throw Error('Perubahan belum dikonfirmasi.');
  if(el('view-detail-kasus').classList.contains('block')&&selectedCase){await loadCases({force:true});await openCase(selectedCase.id_kasus);}else{await Promise.all([loadCashier({force:true}),loadCases({force:true})]);await v21OpenCashier(id);}await notice('Status tersimpan','Status permintaan berhasil diperbarui.','success');
 }catch(e){await notice('Gagal menyimpan status',e.message,'error');}
 finally{btn.disabled=false;}
}
// Independent event wiring: all menu visibility remains controlled by app.js showView().
el('btnAddIntakeRow').addEventListener('click',()=>{if(el('intakeItemsBody').rows.length>=150)return notice('Batas SKU','Maksimal 150 SKU per dokumen.','warning');v21Row();});
el('intakeItemsBody').addEventListener('click',async e=>{const find=e.target.closest('[data-find-intake-sku]');if(find){await findIntakeSku(find);return;}if(e.target.closest('[data-remove-row]')){e.target.closest('tr').remove();if(!el('intakeItemsBody').rows.length)v21Row();}});
el('intakeItemsBody').addEventListener('input',e=>{const row=e.target.closest('tr');if(row)v21UpdateRowDiff(row);});
el('formIntake').addEventListener('submit',v21SaveIntake);
el('btnRefreshIntakes').addEventListener('click',()=>loadIntakes({force:true}));
el('btnExportIntake').addEventListener('click',async()=>{await Promise.all([loadIntakes({force:true}),loadCashier({force:true})]);v21Export();});
el('intakeDetail').addEventListener('click',async e=>{
 const target=e.target.closest('button');if(!target)return;
 if(target.dataset.closeIntake){v21SelectedIntake=null;el('intakeDetail').replaceChildren();return;}
 if(target.dataset.downloadId){downloadClick(e);return;}
  if(target.dataset.archiveIntake){archiveRecord('intake',target.dataset.archiveIntake);return;}
  if(target.dataset.archiveRecord){archiveRecord(target.dataset.archiveRecord,target.dataset.archiveId);return;}
 if(target.dataset.intakeCorrection){const item=v21Items.find(x=>String(x.id_intake)===String(v21SelectedIntake)&&x.sku===target.dataset.intakeCorrection);if(item)await prepareStockCorrection({sku:item.sku,name:item.product_name,intake:String(item.id_intake)});return;}
 if(target.dataset.uploadIntake){const files=[...el('intakeDetailFiles').files];if(!files.length)return notice('Pilih bukti','Pilih berkas dahulu.','warning');target.disabled=true;
  try{const evidenceType=el('intakeDetailEvidenceType').value;const r=await v21AttachFiles(files,target.dataset.uploadIntake,el('intakeDetailProgress'),evidenceType);await loadIntakes({force:true});await notice(r.errors.length?'Unggah sebagian':'Bukti tersimpan',`${r.count}/${files.length} bukti dicatat. ${r.errors.join('; ')}` ,r.errors.length?'warning':'success');}
  catch(err){await notice('Unggah gagal',err.message,'error');}finally{target.disabled=false;}
 }
});
el('btnRefreshCashier').addEventListener('click',()=>loadCashier({force:true}));
el('cashierFilter').addEventListener('change',v21RenderCashier);
el('cashierDetail').addEventListener('click',async e=>{const t=e.target.closest('button');if(!t)return;if(t.dataset.correctionCase){await loadCases({force:true});await openCase(t.dataset.correctionCase);return;}if(t.dataset.closeCashier){v21SelectedCashier=null;el('cashierDetail').replaceChildren();}else if(t.dataset.saveCashier)v21UpdateCashier(t.dataset.saveCashier);else if(t.dataset.archiveCashier)archiveRecord('cashier_request',t.dataset.archiveCashier);});
if(!el('intakeItemsBody').rows.length)v21Row();el('intakeDate').value=v21DateBalikpapan();
;

// --- mobile-nav.js ---
/* StockTrace V2.1 mobile navigation.
 * Deliberately isolated from app.js authentication/session lifecycle.
 */
(function () {
  'use strict';

  const sidebar = document.getElementById('appSidebar');
  const toggle = document.getElementById('mobileNavToggle');
  const backdrop = document.querySelector('.st-mobile-nav-backdrop');
  const mobileQuery = window.matchMedia('(max-width: 767px)');

  if (!sidebar || !toggle || !backdrop) return;

  // app.js owns view logic. Wrap only the view switch so mobile starts each
  // screen at its heading instead of retaining the previous screen's scroll.
  const originalShowView = window.showView;
  if (typeof originalShowView === 'function' && !originalShowView.__stMobileScrollReset) {
    const showViewWithScrollReset = function () {
      const result = originalShowView.apply(this, arguments);
      if (mobileQuery.matches) {
        const scroller = document.querySelector('.st-main > .flex-1.overflow-y-auto');
        if (scroller) scroller.scrollTop = 0;
      }
      return result;
    };
    showViewWithScrollReset.__stMobileScrollReset = true;
    window.showView = showViewWithScrollReset;
  }

  function setOpen(open, restoreFocus) {
    const isMobile = mobileQuery.matches;
    if (!isMobile) open = false;

    document.body.classList.toggle('st-mobile-nav-open', Boolean(open));
    sidebar.setAttribute('aria-hidden', String(isMobile && !open));
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
    toggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');

    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('ph-list', !open);
      icon.classList.toggle('ph-x', Boolean(open));
    }

    if (!open && restoreFocus && isMobile) {
      toggle.focus({ preventScroll: true });
    }
  }

  window.toggleMobileNav = function () {
    if (!mobileQuery.matches) return;
    setOpen(!document.body.classList.contains('st-mobile-nav-open'), false);
  };

  window.closeMobileNav = function (options) {
    setOpen(false, Boolean(options && options.restoreFocus));
  };

  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    window.toggleMobileNav();
  });

  backdrop.addEventListener('click', function (event) {
    event.preventDefault();
    window.closeMobileNav();
  });

  sidebar.addEventListener('click', function (event) {
    const navButton = event.target.closest('[data-nav-view]');
    if (navButton && mobileQuery.matches) {
      window.closeMobileNav({ restoreFocus: true });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('st-mobile-nav-open')) {
      window.closeMobileNav({ restoreFocus: true });
    }
  });

  function syncViewport() {
    if (mobileQuery.matches) {
      setOpen(false, false);
    } else {
      document.body.classList.remove('st-mobile-nav-open');
      sidebar.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Buka menu navigasi');
      const icon = toggle.querySelector('i');
      if (icon) {
        icon.classList.add('ph-list');
        icon.classList.remove('ph-x');
      }
    }
  }

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncViewport);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(syncViewport);
  }

  syncViewport();
})();
;

// --- retail.js ---
/* Product catalog, scan-assisted intake and transaction monitoring. */
let retailProducts=[],retailCodes=[],retailCart=[],retailSales=[],retailQueue=[],retailSaleId=null;
let retailScanTarget='',retailEditProduct=null,retailReturnItem=null,retailReturnId=null,retailCameraControls=null,retailCameraStream=null,retailCameraGeneration=0,retailDecoderPromise=null,retailLookupBusy=false,retailLookupGeneration=0;
let retailReportGeneration=0,retailProductGeneration=0,retailQueueGeneration=0;
const retailRp=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
const retailEscape=htmlEscape;
const retailVal=id=>el(id).value.trim();
const retailStatus=(id,msg)=>{el(id).textContent=msg||'';};
const retailDay=()=>v21DateBalikpapan();
const retailUUID=()=>crypto.randomUUID();
function retailInt(value,min,max){const n=Number(value);if(String(value).trim()===''||!Number.isSafeInteger(n)||n<min||n>max)throw Error('Jumlah, harga atau diskon tidak valid.');return n;}
async function retailRpc(name,args){if(!activeUser||mustChangePassword)throw Error('Masuk terlebih dahulu.');const {data,error}=await sb.rpc(name,args);if(error)throw Error(error.message);return data;}
async function retailRead(table,columns='*',apply=q=>q){
 const rows=[];const page=500;for(let from=0;;from+=page){
  const {data,error}=await apply(sb.from(table).select(columns)).range(from,from+page-1);
  if(error)throw Error(error.message);rows.push(...(data||[]));if(!data||data.length<page)return rows;
  if(rows.length>=20000)throw Error('Data melebihi batas 20.000 baris. Gunakan periode lebih pendek.');
 }
}
function openSalesHistory(){showView('sales');requestAnimationFrame(()=>el('retailSalesHistoryTitle').scrollIntoView({block:'start'}));}
function retailView(view){
 if(!activeUser||mustChangePassword)return;
 if(view==='products'){
  retailDetailGeneration++;retailSelectedProduct=null;el('retailProductDetail').hidden=true;retailBalances=new Map();retailLoadProducts();
  el('retailBalancePanel').hidden=!canManageCases();
  if(canManageCases()){el('retailOpeningDate').max=retailDay();if(!el('retailOpeningDate').value)el('retailOpeningDate').value=retailDay();retailLoadBalances();}
 }
 if(view==='sales'){el('retailSeller').textContent=el('displayUserName').textContent;el('retailReturnQueue').hidden=!canManageCases();el('retailSalesFilter').disabled=!canManageCases();retailRenderCart();retailLoadSales();if(canManageCases())retailLoadQueue();}
 if(view==='reports'){el('retailMovementPanel').hidden=!canManageCases();if(canManageCases()){if(!el('retailMovementMonth').value)el('retailMovementMonth').value=retailDay().slice(0,7);retailLoadMovement();}}
}
let retailBalances=new Map(),retailSelectedProduct=null,retailDetailGeneration=0;
async function retailLoadProducts(){
 const gen=++retailProductGeneration;retailStatus('retailProductStatus','Memuat produk...');
 try{const [p,c]=await Promise.all([retailRead('st_products','*',q=>q.order('sku').order('id')),retailRead('st_product_codes','*',q=>q.order('code'))]);if(gen!==retailProductGeneration)return;retailProducts=p;retailCodes=c;retailRenderProducts();retailStatus('retailProductStatus',`${p.length} produk terdaftar.`);}
 catch(e){if(gen===retailProductGeneration){retailProducts=[];retailCodes=[];retailRenderProducts();retailStatus('retailProductStatus','Gagal memuat produk: '+e.message);}}
}
function retailRenderProducts(){
 const q=retailVal('retailProductSearch').toLowerCase(),h=retailEscape;
 const codeByProduct=new Map();retailCodes.forEach(c=>{const a=codeByProduct.get(c.product_id)||[];a.push(c.code);codeByProduct.set(c.product_id,a);});
 el('retailProductRows').innerHTML=retailProducts.filter(p=>[p.sku,p.name,p.color,p.size,...(codeByProduct.get(p.id)||[])].join(' ').toLowerCase().includes(q)).map(p=>`<tr><td>${h(p.sku)}</td><td>${h(p.name)}</td><td>${h([p.color,p.size].filter(Boolean).join(' / '))}</td><td>${h(retailRp(p.price))}</td><td>${canManageCases()?h(retailBalances.get(p.sku)?.estimated_qty??'—'):'Lihat detail'}</td><td><button type="button" class="st-secondary-btn" data-product-detail="${h(p.id)}">Detail</button></td></tr>`).join('')||'<tr><td colspan="6">Belum ada produk.</td></tr>';

}
let retailRegistrationRow=null;
function retailOpenProduct(product=null,code='',target='products'){
 retailRegistrationRow=null;
 retailEditProduct=product;retailScanTarget=target;el('retailProductForm').reset();el('retailEditSku').readOnly=!!product;
 el('retailProductTitle').textContent=product?'Ubah produk / tambah kode':'Daftarkan produk';
 el('retailProductHint').textContent=product?'SKU tidak dapat diubah. Kode tambahan akan terhubung ke produk ini.':code?'Kode belum terdaftar. Isi data dari label produk. Jika SKU sudah ada, minta Leader menambahkan kode.':'Isi informasi sesuai label barang.';
 for(const [field,v] of Object.entries({Sku:product?.sku,Name:product?.name,Color:product?.color,Size:product?.size,Price:product?.price,Code:code}))el('retailEdit'+field).value=v??'';
 retailStatus('retailEditStatus','');el('retailProductDialog').showModal();
}
async function retailSaveProduct(e){
 e.preventDefault();const btn=el('retailSaveProduct');btn.disabled=true;
 try{const args={p_name:retailVal('retailEditName'),p_color:retailVal('retailEditColor'),p_size:retailVal('retailEditSize'),p_price:retailInt(retailVal('retailEditPrice'),0,999999999),p_code:retailVal('retailEditCode')};
  let id;if(retailEditProduct){await retailRpc('st_update_product',{p_id:retailEditProduct.id,...args});id=retailEditProduct.id;}else{id=await retailRpc('st_register_product',{p_sku:retailVal('retailEditSku'),...args});}
  const target=retailScanTarget;const p={id,sku:retailVal('retailEditSku').toUpperCase(),name:args.p_name,color:args.p_color,size:args.p_size,price:args.p_price};
  el('retailProductDialog').close();try{await retailApplyProduct(p,target);}catch(err){await notice('Produk tersimpan',err.message,'warning');}
 }catch(err){retailStatus('retailEditStatus',err.message);}finally{btn.disabled=false;}
}
async function retailFindCode(code){
 const {data:alias,error}=await sb.from('st_product_codes').select('product_id').eq('code',code).maybeSingle();if(error)throw Error(error.message);
 let query=sb.from('st_products').select('*');query=alias?query.eq('id',alias.product_id):query.eq('sku',code.toUpperCase());const r=await query.maybeSingle();if(r.error)throw Error(r.error.message);return r.data;
}
function retailOpenScan(target,manual=false){
 retailStopCamera();retailScanTarget=target;retailLookupGeneration++;retailLookupBusy=false;el('retailScanForm').reset();retailStatus('retailScanStatus',manual?'Ketik SKU atau kode produk.':'Gunakan kamera, scanner eksternal, atau ketik kode.');el('retailScanDialog').showModal();el('retailScanCode').focus();
}
async function retailSubmitScan(e){
 e?.preventDefault();if(retailLookupBusy)return;const code=retailVal('retailScanCode');if(!code||code.length>512)return;
 retailLookupBusy=true;const target=retailScanTarget,gen=retailLookupGeneration;retailStopCamera();retailStatus('retailScanStatus','Mencari produk...');
 try{const p=await retailFindCode(code);if(gen!==retailLookupGeneration||!el('retailScanDialog').open)return;if(p){await retailApplyProduct(p,target);el('retailScanDialog').close();}else{el('retailScanDialog').close();if(['case','inventory','lookup','sales'].includes(target))return notice('Produk belum terdaftar','Daftarkan produk melalui penerimaan barang.','warning');retailOpenProduct(null,code,target);}}
 catch(err){if(gen===retailLookupGeneration)retailStatus('retailScanStatus',err.message);}finally{if(gen===retailLookupGeneration)retailLookupBusy=false;}
}
function retailStopCamera(){
 retailCameraGeneration++;try{retailCameraControls?.stop();}catch(_){}retailCameraControls=null;
 const video=el('retailVideo');const stream=video.srcObject||retailCameraStream;stream?.getTracks().forEach(t=>t.stop());retailCameraStream=null;video.srcObject=null;video.hidden=true;el('retailCamera').textContent='Aktifkan kamera';
}
function retailLoadDecoder(){
 if(window.ZXingBrowser?.BrowserMultiFormatReader)return Promise.resolve(window.ZXingBrowser);
 if(!retailDecoderPromise)retailDecoderPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';script.onload=()=>window.ZXingBrowser?.BrowserMultiFormatReader?resolve(window.ZXingBrowser):reject(Error('Pemindai tidak tersedia.'));script.onerror=()=>{script.remove();reject(Error('Library pemindai gagal dimuat.'));};document.head.appendChild(script);}).catch(e=>{retailDecoderPromise=null;throw e;});return retailDecoderPromise;
}
async function retailStartCamera(){
 if(!el('retailScanDialog').open)return;
 if(!el('retailVideo').hidden){retailStopCamera();return;}
 if(!navigator.mediaDevices?.getUserMedia){retailStatus('retailScanStatus','Kamera tidak tersedia. Gunakan input manual.');return;}
 const gen=++retailCameraGeneration,video=el('retailVideo');video.hidden=false;el('retailCamera').textContent='Matikan kamera';retailStatus('retailScanStatus','Mengaktifkan kamera...');
 const accept=code=>{if(gen!==retailCameraGeneration||!el('retailScanDialog').open||!code)return;if(String(code).length>512){retailStopCamera();retailStatus('retailScanStatus','Kode terlalu panjang. Ketik SKU secara manual.');return;}el('retailScanCode').value=String(code);retailSubmitScan();};
 try{
  // ZXing supports both 1-D barcodes and QR. Native scanning is an optional fallback.
  let lib=null;try{lib=await retailLoadDecoder();}catch(_){if(!window.BarcodeDetector)throw _;}
  if(gen!==retailCameraGeneration)return;
  if(lib){const reader=new lib.BrowserMultiFormatReader();const controls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'}}},video,(result)=>{if(result)accept(result.getText());});if(gen!==retailCameraGeneration){controls.stop();return;}retailCameraControls=controls;}
  else{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(gen!==retailCameraGeneration){stream.getTracks().forEach(t=>t.stop());return;}retailCameraStream=stream;video.srcObject=stream;await video.play();const detector=new BarcodeDetector();const tick=async()=>{if(gen!==retailCameraGeneration)return;try{const codes=await detector.detect(video);if(codes.length){accept(codes[0].rawValue);return;}}catch(_){}setTimeout(tick,180);};tick();}
  if(gen===retailCameraGeneration)retailStatus('retailScanStatus',['intake','sales'].includes(retailScanTarget)?'Arahkan kamera ke kode. Satu pemindaian menambah satu barang.':'Arahkan kamera ke barcode atau QR Code.');
 }catch(e){if(gen===retailCameraGeneration){retailStopCamera();retailStatus('retailScanStatus','Kamera tidak dapat dipakai: '+e.message+'. Gunakan input manual.');}}
}
async function retailApplyProduct(p,target){
 if(target==='lookup'){if(!activeUser||mustChangePassword)throw Error('Sesi tidak tersedia.');showView('products');target='inventory';}
 if(target==='intake-from-master'){if(mustChangePassword||!activeUser)throw Error('Sesi tidak tersedia.');showView('intake');target='intake-register';}
 if(target==='inventory'){el('retailProductSearch').value=p.sku;await retailLoadProducts();await retailOpenDetail(p);return;}
 if(target==='case'){
  const sku=el('inputSKU'),name=el('inputNama');
  if(sku.value.trim().toUpperCase()!==p.sku.toUpperCase()){el('inputSistem').value='';el('inputFisik').value='';}
  sku.value=p.sku;name.value=p.name;retailPreviewDifference();await showCaseEstimate(p.sku);return;
 }
 if(target==='intake'||target==='intake-register'){
  const rows=[...el('intakeItemsBody').rows],get=(r,f)=>r.querySelector(`[data-field="${f}"]`);let row=rows.find(r=>get(r,'sku').value.trim().toUpperCase()===p.sku.toUpperCase());
  if(target==='intake-register'&&retailRegistrationRow?.isConnected){if(row&&row!==retailRegistrationRow)throw Error('SKU sudah ada dalam penerimaan. Gunakan baris yang sudah ada.');row=retailRegistrationRow;get(row,'sku').value=p.sku;get(row,'product_name').value=p.name;retailRegistrationRow=null;}
  if(!row){row=rows.find(r=>!get(r,'sku').value.trim()&&!get(r,'product_name').value.trim()&&['qty_document','qty_received','qty_rejected'].every(f=>Number(get(r,f).value)===0)&&!get(r,'reject_reason').value.trim());if(!row){if(rows.length>=150)throw Error('Maksimal 150 SKU per penerimaan.');row=v21Row();}get(row,'sku').value=p.sku;get(row,'product_name').value=p.name;}
  const input=get(row,'qty_received');if(target==='intake')input.value=retailInt(input.value,0,999999998)+1;v21UpdateRowDiff(row);input.focus();
 }else if(target==='sales'){
  const item=retailCart.find(x=>x.id===p.id);if(item){if(item.qty>=9999)throw Error('Maksimal 9.999 unit per item.');item.qty++;}else{if(retailCart.length>=150)throw Error('Maksimal 150 SKU per transaksi.');retailCart.push({...p,qty:1,unit_price:Number(p.price),discount:0});}retailRenderCart();
 }else{el('retailProductSearch').value=p.sku;await retailLoadProducts();if(retailSelectedProduct?.id===p.id)await retailOpenDetail(p);}
}
function retailCartTotals(cart){return cart.reduce((a,i)=>{a.qty+=i.qty;a.gross+=i.qty*i.unit_price;a.discount+=i.discount;return a;},{qty:0,gross:0,discount:0});}
function retailRenderCart(){
 const h=retailEscape;el('retailCartRows').innerHTML=retailCart.map((p,i)=>`<tr><td>${h(p.sku)}<br>${h(p.name)} ${h(p.color)} ${h(p.size)}</td><td><input aria-label="Jumlah" type="number" class="st-field" min="1" max="9999" step="1" data-cart-index="${i}" data-cart-field="qty" value="${p.qty}" required></td><td><input aria-label="Harga satuan" type="number" class="st-field" min="0" max="999999999" step="1" data-cart-index="${i}" data-cart-field="unit_price" value="${p.unit_price}" required></td><td><input aria-label="Diskon total item" type="number" class="st-field" min="0" step="1" data-cart-index="${i}" data-cart-field="discount" value="${p.discount}" required></td><td data-cart-subtotal="${i}">${h(retailRp(p.qty*p.unit_price-p.discount))}</td><td><button type="button" data-cart-remove="${i}">Hapus</button></td></tr>`).join('')||'<tr><td colspan="6">Belum ada barang.</td></tr>';retailRefreshCartTotal();
}
function retailRefreshCartTotal(){const t=retailCartTotals(retailCart);el('retailCartTotal').textContent=retailRp(t.gross-t.discount);}
function retailCartInput(e){const inp=e.target.closest('[data-cart-field]');if(!inp)return;const i=Number(inp.dataset.cartIndex),item=retailCart[i];if(!item)return;const field=inp.dataset.cartField;try{item[field]=retailInt(inp.value,field==='qty'?1:0,field==='qty'?9999:field==='unit_price'?999999999:9999999999999);inp.setCustomValidity('');}catch(err){inp.setCustomValidity(err.message);return;}const row=inp.closest('tr');const discount=row.querySelector('[data-cart-field="discount"]');discount.setCustomValidity(item.discount>item.qty*item.unit_price?'Diskon melebihi nilai barang.':'');row.querySelector('[data-cart-subtotal]').textContent=retailRp(item.qty*item.unit_price-item.discount);retailRefreshCartTotal();}
async function retailSaveSale(e){e.preventDefault();const btn=el('retailSaveSale');if(!retailCart.length){retailStatus('retailSaleStatus','Tambahkan barang dahulu.');return;}btn.disabled=true;const form=el('retailSaleForm'),controls=[...form.querySelectorAll('input,button')].filter(c=>c!==btn&&!c.disabled);controls.forEach(c=>c.disabled=true);
 try{const receipt=retailVal('retailReceipt');if(!receipt)throw Error('Nomor struk wajib diisi.');const items=retailCart.map(i=>({product_id:i.id,qty:retailInt(i.qty,1,9999),unit_price:retailInt(i.unit_price,0,999999999),discount:retailInt(i.discount,0,i.qty*i.unit_price)}));
  // Keep the same transaction ID if the network drops after the server saves it.
  retailSaleId=retailSaleId||retailUUID();const id=retailSaleId;
  let existing=await sb.from('st_sales').select('id,receipt,st_sale_items(product_id,qty,unit_price,discount)').eq('id',id).maybeSingle();if(existing.error)throw Error(existing.error.message);
  if(existing.data){const saved=existing.data.st_sale_items||[];if(existing.data.receipt!==receipt||saved.length!==items.length||!items.every(i=>saved.some(x=>x.product_id===i.product_id&&Number(x.qty)===i.qty&&Number(x.unit_price)===i.unit_price&&Number(x.discount)===i.discount)))throw Error('Transaksi sebelumnya sudah tersimpan dengan rincian berbeda. Periksa riwayat dan muat ulang halaman.');}
  else await retailRpc('st_record_sale',{p_id:id,p_receipt:receipt,p_items:items});
  retailCart=[];retailSaleId=null;el('retailReceipt').value='';retailRenderCart();retailStatus('retailSaleStatus','Penjualan tersimpan.');await retailLoadSales();
 }catch(err){retailStatus('retailSaleStatus','Gagal menyimpan: '+err.message);}finally{btn.disabled=false;controls.forEach(c=>c.disabled=false);}}
function retailMonthRange(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Pilih bulan transaksi.');const [y,m]=month.split('-').map(Number);const next=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;return [new Date(`${month}-01T00:00:00+08:00`).toISOString(),new Date(`${next}-01T00:00:00+08:00`).toISOString()];}
async function retailLoadSales(){
 const gen=++retailReportGeneration;if(!el('retailMonth').value)el('retailMonth').value=retailDay().slice(0,7);retailStatus('retailReportStatus','Memuat penjualan...');el('retailExport').disabled=true;
 try{const [from,to]=retailMonthRange(retailVal('retailMonth'));const sales=await retailRead('st_sales','*,st_sale_items(*,st_returns(*))',q=>q.gte('created_at',from).lt('created_at',to).order('created_at',{ascending:false}).order('id'));
  if(gen!==retailReportGeneration)return;retailSales=sales;const filter=el('retailSalesFilter'),old=filter.value;filter.replaceChildren(new Option('Semua',''));if(canManageCases()){const names=new Map(sales.map(s=>[s.seller,s.seller_name]));[...names].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>filter.add(new Option(name,id)));}filter.value=[...filter.options].some(o=>o.value===old)?old:'';retailRenderReport();retailStatus('retailReportStatus',`${sales.length} transaksi dalam periode (termasuk batal).`);el('retailExport').disabled=false;
 }catch(e){if(gen!==retailReportGeneration)return;retailSales=[];retailRenderReport();retailStatus('retailReportStatus','Gagal memuat penjualan: '+e.message);}
}
function retailItemTotals(i){const approved=(i.st_returns||[]).filter(r=>r.status==='approved');const pending=(i.st_returns||[]).filter(r=>r.status==='pending').reduce((a,r)=>a+Number(r.qty),0);const returned=approved.reduce((a,r)=>a+Number(r.qty),0),refund=approved.reduce((a,r)=>a+Number(r.refund),0),gross=Number(i.qty)*Number(i.unit_price),discount=Number(i.discount);return {qty:Number(i.qty),returned,pending,gross,discount,refund,net:gross-discount-refund};}
const retailEmptyTotals=()=>({transactions:0,qty:0,returned:0,gross:0,discount:0,refund:0,net:0});
function retailSummarize(sales){const groups=new Map(),total=retailEmptyTotals();for(const s of sales){if(s.voided_at)continue;let g=groups.get(s.seller);if(!g){g={id:s.seller,name:s.seller_name,...retailEmptyTotals()};groups.set(s.seller,g);}g.transactions++;total.transactions++;for(const i of s.st_sale_items||[]){const v=retailItemTotals(i);for(const k of ['qty','returned','gross','discount','refund','net']){g[k]+=v[k];total[k]+=v[k];}}}return {groups:[...groups.values()].sort((a,b)=>b.net-a.net),total};}
function retailFilteredSales(){const id=retailVal('retailSalesFilter'),q=retailVal('retailReceiptSearch').toLowerCase();return retailSales.filter(s=>(!id||s.seller===id)&&(!q||String(s.receipt).toLowerCase().includes(q)||(s.st_sale_items||[]).some(i=>String(i.sku).toLowerCase().includes(q))));}
function retailRenderReport(){
 const h=retailEscape,sales=retailFilteredSales(),{groups,total}=retailSummarize(sales);
 el('retailKpis').innerHTML=[['Transaksi',total.transactions],['Barang terjual setelah retur',total.qty-total.returned],['Omzet bersih',retailRp(total.net)]].map(([k,v])=>`<div><small>${h(k)}</small><strong>${h(v)}</strong></div>`).join('');
 el('retailSalesSummary').innerHTML=groups.map(g=>`<tr><td>${h(g.name)}</td><td>${g.transactions}</td><td>${g.qty}</td><td>${g.returned}</td><td>${h(retailRp(g.gross))}</td><td>${h(retailRp(g.discount))}</td><td>${h(retailRp(g.refund))}</td><td>${h(retailRp(g.net))}</td></tr>`).join('')||'<tr><td colspan="8">Belum ada transaksi aktif.</td></tr>';
 el('retailHistory').innerHTML=sales.flatMap(s=>(s.st_sale_items||[]).map((i,index)=>{const t=retailItemTotals(i);const returns=(i.st_returns||[]).map(r=>`${r.qty} pcs · ${h({pending:'Menunggu',approved:'Disetujui',rejected:'Ditolak'}[r.status]||r.status)} · ${h(({layak:"Layak jual",reject:"Reject"})[r.condition]||r.condition)} · ${h(({refund:"Pengembalian dana",exchange:"Tukar barang"})[r.kind]||r.kind)} · ${h(r.reason)}`).join('<br>');return `<tr><td>${h(s.receipt)}<br>${h(niceDate(s.created_at))}${s.voided_at?'<br><strong>Batal</strong>':''}</td><td>${h(s.seller_name)}</td><td>${h(i.sku)}<br>${h(i.name)} ${h(i.color)} ${h(i.size)}</td><td>${t.qty}</td><td>${h(retailRp(i.unit_price))}<br>Diskon ${h(retailRp(t.discount))}</td><td>${returns||'—'}</td><td>${s.voided_at?'—':h(retailRp(t.net))}</td><td>${!s.voided_at&&t.qty-t.returned-t.pending>0?`<button type="button" data-return-item="${h(i.id)}">Ajukan retur</button>`:''}${!s.voided_at&&index===0&&canManageCases()?`<br><button type="button" data-void-sale="${h(s.id)}">Batalkan</button>`:''}</td></tr>`;})).join('')||'<tr><td colspan="8">Belum ada penjualan.</td></tr>';
}
function retailExport(){const sales=retailFilteredSales(),{groups}=retailSummarize(sales);const summary=[['Sales','Transaksi','Jumlah terjual','Jumlah retur','Jumlah setelah retur','Omzet kotor','Diskon','Nilai retur','Omzet bersih'],...groups.map(g=>[g.name,g.transactions,g.qty,g.returned,g.qty-g.returned,g.gross,g.discount,g.refund,g.net])];const detail=[['Struk','Waktu WITA','Sales','SKU','Produk','Warna','Ukuran','Jumlah','Harga satuan','Diskon','Jumlah retur','Nilai retur','Omzet bersih','Status'],...sales.flatMap(s=>(s.st_sale_items||[]).map(i=>{const t=retailItemTotals(i);return [s.receipt,niceDate(s.created_at),s.seller_name,i.sku,i.name,i.color,i.size,t.qty,Number(i.unit_price),t.discount,t.returned,t.refund,s.voided_at?0:t.net,s.voided_at?'Batal':'Aktif'];}))];const returns=[['Struk','Sales awal','SKU','Jumlah','Kondisi','Jenis','Alasan','Status','Nilai retur','Waktu permintaan','Waktu keputusan','Catatan keputusan'],...sales.flatMap(s=>(s.st_sale_items||[]).flatMap(i=>(i.st_returns||[]).map(r=>[s.receipt,s.seller_name,i.sku,r.qty,r.condition,r.kind,r.reason,r.status,Number(r.refund),niceDate(r.created_at),r.decided_at?niceDate(r.decided_at):'',r.decision_note||''])))];StockTraceXlsx.save([{name:'Rekap Sales',rows:summary},{name:'Detail Item',rows:detail},{name:'Retur',rows:returns}],`StockTrace_Penjualan_${retailVal('retailMonth')}.xlsx`);}
function retailOpenReturn(id){const i=retailSales.flatMap(s=>s.st_sale_items||[]).find(x=>x.id===id);if(!i)return;const t=retailItemTotals(i);retailReturnItem=i;retailReturnId=retailUUID();el('retailReturnForm').reset();el('retailReturnItem').textContent=`${i.sku} – ${i.name} | Batas jumlah retur ${t.qty-t.returned-t.pending}`;el('retailReturnQty').max=t.qty-t.returned-t.pending;el('retailReturnQty').value=1;retailStatus('retailReturnStatus','');el('retailReturnDialog').showModal();}
async function retailSaveReturn(e){e.preventDefault();const btn=el('retailSaveReturn');btn.disabled=true;try{const payload={p_id:retailReturnId,p_item:retailReturnItem.id,p_qty:retailInt(retailVal('retailReturnQty'),1,Number(el('retailReturnQty').max)),p_condition:retailVal('retailReturnCondition'),p_kind:retailVal('retailReturnKind'),p_reason:retailVal('retailReturnReason')};const existing=await sb.from('st_returns').select('id,item_id,qty,condition,kind,reason').eq('id',retailReturnId).maybeSingle();if(existing.error)throw Error(existing.error.message);if(existing.data){if(existing.data.item_id!==payload.p_item||Number(existing.data.qty)!==payload.p_qty||existing.data.condition!==payload.p_condition||existing.data.kind!==payload.p_kind||existing.data.reason!==payload.p_reason)throw Error('Retur sebelumnya telah tersimpan. Periksa riwayat.');}else await retailRpc('st_request_return',payload);el('retailReturnDialog').close();await retailLoadSales();if(canManageCases())retailLoadQueue();await notice('Retur diajukan','Menunggu persetujuan Leader.','success');}catch(err){retailStatus('retailReturnStatus',err.message);}finally{btn.disabled=false;}}
async function retailLoadQueue(){if(!canManageCases())return;const gen=++retailQueueGeneration;retailStatus('retailQueueStatus','Memuat retur...');try{const rows=await retailRead('st_returns','*,st_sale_items(sku,name,st_sales(receipt,seller_name))',q=>q.eq('status','pending').order('created_at').order('id'));if(gen!==retailQueueGeneration)return;retailQueue=rows;const h=retailEscape;el('retailQueueRows').innerHTML=rows.map(r=>`<div class="border rounded-lg p-3 mb-2"><strong>${h(r.st_sale_items?.st_sales?.receipt)} – ${h(r.st_sale_items?.st_sales?.seller_name)}</strong><p>${h(r.st_sale_items?.sku)} ${h(r.st_sale_items?.name)} · ${r.qty} pcs · ${h(({layak:"Layak jual",reject:"Reject"})[r.condition]||r.condition)} · ${h(({refund:"Pengembalian dana",exchange:"Tukar barang"})[r.kind]||r.kind)}</p><p>${h(r.reason)}</p><div class="st-retail-actions"><button type="button" class="st-primary-btn" data-return-approve="${h(r.id)}">Setujui</button><button type="button" class="st-secondary-btn" data-return-reject="${h(r.id)}">Tolak</button></div></div>`).join('')||'Tidak ada retur yang menunggu persetujuan.';retailStatus('retailQueueStatus','');}catch(e){if(gen===retailQueueGeneration){el('retailQueueRows').replaceChildren();retailStatus('retailQueueStatus',e.message);}}}
async function retailAskReason(title){if(window.Swal?.fire){const r=await Swal.fire({title,input:'textarea',inputLabel:'Alasan / catatan (8–1000 karakter)',showCancelButton:true,confirmButtonText:'Lanjutkan',cancelButtonText:'Batal',confirmButtonColor:'#1e293b',inputValidator:v=>v.trim().length<8||v.trim().length>1000?'Isi 8–1000 karakter.':undefined});return r.isConfirmed?r.value.trim():null;}const s=window.prompt(title+' (min. 8 karakter)');return s&&s.trim().length>=8&&s.trim().length<=1000?s.trim():null;}
async function retailDecision(id,approve){const note=await retailAskReason(approve?'Setujui retur?':'Tolak retur?');if(!note)return;try{await retailRpc('st_decide_return',{p_id:id,p_approve:approve,p_note:note});await Promise.all([retailLoadSales(),retailLoadQueue()]);}catch(e){await notice('Retur gagal',e.message,'error');}}
async function retailVoid(id){const reason=await retailAskReason('Batalkan transaksi?');if(!reason)return;try{await retailRpc('st_void_sale',{p_id:id,p_reason:reason});await retailLoadSales();}catch(e){await notice('Pembatalan gagal',e.message,'error');}}
function retailBind(id,event,fn){el(id).addEventListener(event,fn);}
function retailTopScanTarget(view){return view==='intake'?'intake':view==='sales'?'sales':view==='form-laporan'?'case':view==='products'?'inventory':'lookup';}
function retailTopScan(){
 if(!activeUser||mustChangePassword||el('retailTopScan').disabled)return;
 const view=['intake','sales','form-laporan','products'].find(v=>!el('view-'+v).classList.contains('hidden'));
 if(view==='form-laporan'&&el('inputSKU').readOnly)return;
 const target=retailTopScanTarget(view);retailOpenScan(target);retailStartCamera();
}
retailBind('retailTopScan','click',retailTopScan);retailBind('retailSaleManual','click',()=>retailOpenScan('sales',true));retailBind('retailNewIntakeProduct','click',()=>retailOpenProduct(null,'','intake-register'));retailBind('retailProductRefresh','click',()=>{retailLoadProducts();if(canManageCases())retailLoadBalances();});retailBind('retailProductSearch','input',retailRenderProducts);
retailBind('retailScanForm','submit',retailSubmitScan);retailBind('retailCamera','click',retailStartCamera);retailBind('retailCloseScan','click',()=>el('retailScanDialog').close());retailBind('retailScanDialog','close',retailStopCamera);retailBind('retailScanDialog','cancel',retailStopCamera);window.addEventListener('pagehide',retailStopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden)retailStopCamera();});
retailBind('retailProductForm','submit',retailSaveProduct);retailBind('retailCloseProduct','click',()=>el('retailProductDialog').close());
retailBind('retailProductRows','click',e=>{const b=e.target.closest('[data-product-detail]');if(b){const p=retailProducts.find(x=>x.id===b.dataset.productDetail);if(p)retailOpenDetail(p);}});
retailBind('retailCartRows','input',retailCartInput);retailBind('retailCartRows','click',e=>{const b=e.target.closest('[data-cart-remove]');if(b){retailCart.splice(Number(b.dataset.cartRemove),1);retailRenderCart();}});retailBind('retailSaleForm','submit',retailSaveSale);
retailBind('retailMonth','change',retailLoadSales);retailBind('retailSalesFilter','change',retailRenderReport);retailBind('retailReceiptSearch','input',retailRenderReport);retailBind('retailSalesRefresh','click',retailLoadSales);retailBind('retailExport','click',retailExport);retailBind('retailHistory','click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.returnItem)retailOpenReturn(b.dataset.returnItem);if(b.dataset.voidSale&&canManageCases())retailVoid(b.dataset.voidSale);});
retailBind('retailReturnForm','submit',retailSaveReturn);retailBind('retailCloseReturn','click',()=>el('retailReturnDialog').close());retailBind('retailQueueRefresh','click',retailLoadQueue);retailBind('retailQueueRows','click',e=>{const b=e.target.closest('button');if(!b||!canManageCases())return;if(b.dataset.returnApprove)retailDecision(b.dataset.returnApprove,true);if(b.dataset.returnReject)retailDecision(b.dataset.returnReject,false);});

let retailMovementGeneration=0;
async function retailLoadMovement(){
 const gen=++retailMovementGeneration;retailStatus('retailMovementStatus','Memuat pergerakan...');el('retailMovementRows').replaceChildren();
 try{const rows=await retailRpc('st_monthly_movements',{p_month:retailVal('retailMovementMonth')+'-01'});if(gen!==retailMovementGeneration)return;el('retailMovementRows').innerHTML=(rows||[]).map(r=>`<tr><td>${retailEscape(r.sku)}<br>${retailEscape(r.name)}</td>${['received','intake_reject','sold','returned_good','returned_reject','movement'].map(k=>`<td>${retailEscape(r[k])}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="7">Belum ada pergerakan.</td></tr>';retailStatus('retailMovementStatus','');}catch(e){if(gen===retailMovementGeneration)retailStatus('retailMovementStatus',e.message);}
}

let retailBalanceGeneration=0;
async function retailLoadBalances(){
 if(!canManageCases())return;
 const gen=++retailBalanceGeneration;retailStatus('retailBalanceStatus','Memuat estimasi stok...');
 try{const rows=await retailRpc('st_estimated_balances',{});if(gen!==retailBalanceGeneration)return;const h=retailEscape;
 retailBalances=new Map((rows||[]).map(r=>[r.sku,r]));retailRenderProducts();if(retailSelectedProduct)retailRenderDetailBalance(retailSelectedProduct);

 retailStatus('retailBalanceStatus',(rows||[]).some(r=>r.estimated_qty!=null&&Number(r.estimated_qty)<0)?'Ada estimasi stok negatif. Periksa kembali.':'');
 }catch(e){if(gen===retailBalanceGeneration){retailBalances=new Map();retailRenderProducts();retailStatus('retailBalanceStatus',e.message);retailStatus('retailProductStatus','Estimasi stok belum tersedia: '+e.message);}}
}
async function retailSaveOpening(e){
 e.preventDefault();if(!canManageCases())return;const btn=el('retailOpeningSave');btn.disabled=true;
 try{const date=retailVal('retailOpeningDate');if(!date||date>retailDay())throw Error('Tanggal tidak valid.');
 const qty=retailInt(retailVal('retailOpeningQty'),0,999999999),sku=retailVal('retailOpeningSku'),note=retailVal('retailOpeningNote');
 if(!sku||note.length<8)throw Error('Isi SKU dan catatan verifikasi.');
 const confirmed=window.Swal?.fire? (await Swal.fire({title:'Simpan stok awal?',text:`${sku}: ${qty} pcs pada awal hari ${date}. Pastikan jumlah sesuai stok fisik sebelum transaksi.`,showCancelButton:true,confirmButtonText:'Simpan',cancelButtonText:'Batal',confirmButtonColor:'#1e293b'})).isConfirmed:window.confirm(`Simpan stok awal ${sku}: ${qty} pcs pada ${date}?`);
 if(!confirmed)return;await retailRpc('st_verify_opening',{p_sku:sku,p_on:date,p_qty:qty,p_note:note});el('retailOpeningForm').reset();el('retailOpeningDetails').open=false;el('retailOpeningSku').value=sku;el('retailOpeningDate').value=retailDay();await retailLoadBalances();await notice('Stok awal tersimpan','Stok awal berhasil diperbarui.','success');
 }catch(err){retailStatus('retailBalanceStatus',err.message);}finally{btn.disabled=false;}
}
retailBind('retailMovementMonth','change',retailLoadMovement);retailBind('retailMovementRefresh','click',retailLoadMovement);
retailBind('retailOpeningForm','submit',retailSaveOpening);
retailBind('retailBalanceRefresh','click',retailLoadBalances);
;

// Stock inspection uses the official cashier count entered by the user. The estimate stays separate.
let caseEstimateGeneration=0;
async function showCaseEstimate(sku){
 const gen=++caseEstimateGeneration, node=el('caseEstimate');node.textContent='';if(!sku)return;
 try{const data=await retailRpc('st_stock_for_sku',{p_sku:sku});if(gen!==caseEstimateGeneration||el('inputSKU').value.trim().toUpperCase()!==sku.toUpperCase())return;
 node.textContent=data?.estimated_qty==null?'Stok awal belum ditetapkan.':'Estimasi stok: '+data.estimated_qty+' pcs';
 }catch(e){if(gen===caseEstimateGeneration)node.textContent='Estimasi tidak tersedia.';}
}
retailBind('inputSKU','input',()=>{caseEstimateGeneration++;el('caseEstimate').textContent='';el('inputNama').value='';el('inputSistem').value='';el('inputFisik').value='';retailPreviewDifference();});
retailBind('formLaporanLengkap','reset',()=>{caseEstimateGeneration++;el('caseEstimate').textContent='';caseSourceIntake=null;el('caseIntakeSource').hidden=true;el('caseIntakeSource').textContent='';el('inputSKU').readOnly=false;el('retailTopScan').disabled=false;});
for(const [skuId,nameId,target] of [['inputSKU','inputNama','case']]){
 retailBind(skuId,'change',async()=>{const code=el(skuId).value.trim();if(!code)return;
 try{const p=await retailFindCode(code);if(el(skuId).value.trim()!==code)return;if(!p){el(nameId).value='';return;}el(skuId).value=p.sku;el(nameId).value=p.name;if(target==='case')await showCaseEstimate(p.sku);}catch(e){await notice('Pencarian produk gagal',e.message,'error');}});
}
// A single product context links transactions, reports and opening balances.
function retailRenderDetailBalance(p){
 const b=retailBalances.get(p.sku);if(!b)return;
 el('retailDetailStock').textContent=b.estimated_qty==null?'Stok awal belum ditetapkan.':'Estimasi stok: '+b.estimated_qty+' pcs';
 const values=[['Stok awal',b.opening_qty],['Diterima',b.received],['Terjual',b.sold],['Retur layak',b.returned_good]];
 el('retailDetailKpis').innerHTML=values.map(([label,n])=>`<div><small>${retailEscape(label)}</small><strong>${retailEscape(n??'—')}</strong></div>`).join('');
}
async function retailOpenDetail(p){
 if(retailSelectedProduct?.id!==p.id&&el('retailOpeningDetails').open&&(el('retailOpeningQty').value||el('retailOpeningNote').value)&&!window.confirm('Ganti stok awal yang belum disimpan?'))return;
 const gen=++retailDetailGeneration;retailSelectedProduct=p;const node=el('retailProductDetail');node.hidden=false;
 el('retailDetailTitle').textContent=[p.name,p.color,p.size,p.sku].filter(Boolean).join(' · ');
 el('retailDetailStock').textContent='Memuat estimasi stok...';el('retailDetailKpis').replaceChildren();el('retailDetailCases').textContent='Memuat laporan...';
 el('retailDetailEdit').hidden=!canManageCases();el('retailBalancePanel').hidden=!canManageCases();
 el('retailOpeningForm').reset();el('retailOpeningDetails').open=false;el('retailOpeningSku').value=p.sku;el('retailOpeningDate').value=retailDay();el('retailDetailHistory').open=false;el('retailDetailHistory').hidden=!canManageCases();el('retailDetailHistoryRows').replaceChildren();
 if(canManageCases())retailRenderDetailBalance(p);
 const current=()=>gen===retailDetailGeneration&&retailSelectedProduct?.id===p.id;
 const stock=retailRpc('st_stock_for_sku',{p_sku:p.sku}).then(b=>{if(current())el('retailDetailStock').textContent=b?.estimated_qty==null?'Stok awal belum ditetapkan.':'Estimasi stok: '+b.estimated_qty+' pcs';}).catch(e=>{if(current())el('retailDetailStock').textContent='Estimasi belum tersedia: '+e.message;});
 const cases=retailRead('cases','id_kasus,status_kasus,selisih,created_at',q=>q.eq('sku_produk',p.sku).is('deleted_at',null).order('created_at',{ascending:false}).order('id_kasus')).then(rows=>{if(current())el('retailDetailCases').innerHTML=rows.map(r=>`<div class="st-detail-report"><button type="button" class="st-secondary-btn" data-product-case="${retailEscape(r.id_kasus)}">${retailEscape(r.id_kasus)}</button><span>${retailEscape(r.status_kasus)} · Selisih ${retailEscape(r.selisih)}</span></div>`).join('')||'Belum ada laporan.';}).catch(e=>{if(current())el('retailDetailCases').textContent='Gagal membaca laporan: '+e.message;});
 node.scrollIntoView({block:'start'});await Promise.all([stock,cases]);
}
async function retailInspectProduct(p){
 if(!p||mustChangePassword||!activeUser)return;
 if((el('inputSKU').value.trim()||el('inputKronologi').value.trim()||el('inputFile').files.length)&&!window.confirm('Ganti pemeriksaan yang belum disimpan?'))return;
 showView('form-laporan');el('formLaporanLengkap').reset();await retailApplyProduct(p,'case');el('inputSistem').focus();
}
retailBind('retailDetailClose','click',()=>{retailDetailGeneration++;retailSelectedProduct=null;el('retailProductDetail').hidden=true;});
retailBind('retailDetailCheck','click',()=>retailInspectProduct(retailSelectedProduct));
retailBind('retailDetailReceive','click',async()=>{const p=retailSelectedProduct;if(p)try{await retailApplyProduct(p,'intake-from-master');}catch(e){await notice('Penerimaan belum diisi',e.message,'warning');}});
retailBind('retailDetailSell','click',async()=>{const p=retailSelectedProduct;if(p)try{showView('sales');await retailApplyProduct(p,'sales');}catch(e){await notice('Penjualan belum diisi',e.message,'warning');}});
retailBind('retailDetailEdit','click',()=>{if(retailSelectedProduct&&canManageCases())retailOpenProduct(retailSelectedProduct);});
retailBind('retailDetailCases','click',e=>{const b=e.target.closest('[data-product-case]');if(b)openCase(b.dataset.productCase);});

function retailPreviewDifference(){
 const sys=v21Int(el('inputSistem')),fis=v21Int(el('inputFisik')),known=sys!==null&&fis!==null,match=known&&sys===fis;
 el('caseDifferencePreview').textContent=known?(match?'Stok sesuai. Tidak perlu laporan.':'Selisih: '+(fis-sys)+' pcs'):'';
 el('caseEvidenceFields').hidden=match;el('inputKronologi').required=!match;el('inputFile').required=!match;
 el('btnSubmitLaporan').textContent=match?'Selesai pemeriksaan':'Kirim Laporan';
}
for(const id of ['inputSistem','inputFisik'])retailBind(id,'input',retailPreviewDifference);
retailBind('formLaporanLengkap','reset',()=>queueMicrotask(retailPreviewDifference));

// Ledger reads are lazy and Leader-only; no extra queries for scanning or Staff sales.
async function retailLoadProductHistory(p){
 if(!p||!canManageCases())return;const gen=retailDetailGeneration,cur=()=>gen===retailDetailGeneration&&retailSelectedProduct?.id===p.id;
 retailStatus('retailDetailHistoryStatus','Memuat riwayat...');
 try{
 const [intake,sales]=await Promise.all([
  retailRead('stocktrace_intake_items','id_item,id_intake,qty_accepted,qty_rejected,stocktrace_intakes(document_no,received_on,deleted_at)',q=>q.eq('sku',p.sku).is('deleted_at',null).order('id_item')),
  retailRead('st_sale_items','id,qty,st_sales(receipt,created_at,voided_at),st_returns(id,qty,status,condition,decided_at)',q=>q.eq('product_id',p.id).order('id'))
 ]);if(!cur())return;
 const records=[];
 for(const i of intake){const h=i.stocktrace_intakes;if(!h||h.deleted_at)continue;records.push([h.received_on,'Penerimaan',`+${i.qty_accepted} layak; ${i.qty_rejected||0} reject`,h.document_no||i.id_intake]);}
 for(const i of sales){const h=i.st_sales;if(!h||h.voided_at)continue;records.push([h.created_at,'Penjualan',`−${i.qty}`,h.receipt]);for(const r of i.st_returns||[])if(r.status==='approved')records.push([r.decided_at,'Retur',r.condition==='layak'?`+${r.qty}`:`${r.qty} reject`,h.receipt]);}
 records.sort((a,b)=>String(b[0]).localeCompare(String(a[0])));el('retailDetailHistoryRows').innerHTML=records.map(r=>`<tr><td>${retailEscape(String(r[0]||'').length===10?r[0]:niceDate(r[0]))}</td><td>${retailEscape(r[1])}</td><td>${retailEscape(r[2])}</td><td>${retailEscape(r[3])}</td></tr>`).join('')||'<tr><td colspan="4">Belum ada transaksi.</td></tr>';retailStatus('retailDetailHistoryStatus','');
 }catch(e){if(cur())retailStatus('retailDetailHistoryStatus','Gagal membaca riwayat: '+e.message);}
}
retailBind('retailDetailHistory','toggle',()=>{if(el('retailDetailHistory').open)retailLoadProductHistory(retailSelectedProduct);});
