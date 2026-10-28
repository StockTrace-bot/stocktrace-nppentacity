/* StockTrace Integrated — disesuaikan dengan Supabase: status_kasus/waktu_aksi/waktu_unggah.
 * Hanya publishable key di frontend; seluruh OAuth secret harus tetap di Vercel.
 */
const SUPABASE_URL='https://tcwkfsrxjujsuyttxgfz.supabase.co';
const SUPABASE_KEY='sb_publishable_PlaYZ1SsTeoCiF4FefE-Eg_w1s2uIum';
const sb=window.supabase?.createClient?.(SUPABASE_URL,SUPABASE_KEY)||null;
const el=id=>document.getElementById(id);
const toText=v=>v===null||v===undefined?'':String(v);
const htmlEscape=v=>toText(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const allowedExtensions=new Set(['jpg','jpeg','png','pdf','mp4','webm','doc','docx','xls','xlsx','csv','txt']);
const statuses=['Baru Dilaporkan','Dalam Pemeriksaan','Menunggu Tindak Lanjut IT/MD','Dalam Penyelesaian','Selesai'];
let activeUser=null,activeRole='Staff',cachedCases=[],selectedCase=null;
function notice(title,message,icon='info'){
 if(window.Swal?.fire)return window.Swal.fire({title,text:toText(message),icon,confirmButtonColor:'#1E293B'});
 window.alert(`${title}\n${message}`);return Promise.resolve();
}
function redirectLogin(){window.location.replace('login.html');}
function canManageCases(){return ['leader','admin','store leader','store_leader'].includes(activeRole.toLowerCase().trim());}
function niceDate(value){if(!value)return 'Waktu belum dicatat';let d=new Date(value);if(isNaN(d.getTime()))return 'Waktu tidak valid';return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'}).format(d)+' WITA';}
function showView(view){
 for(const name of ['dashboard','form-laporan','detail-kasus','archive','reports']){
  const node=el('view-'+name); if(node){node.classList.toggle('hidden',view!==name);node.classList.toggle('block',view===name);}
 }
 if(view==='dashboard'&&activeUser)loadCases();
 if(view==='archive'&&activeUser)loadArchive();
 if(view==='reports'&&activeUser)renderReports();
}
async function checkAuth(){
 if(!sb)return notice('Koneksi Supabase gagal','Pustaka Supabase tidak bisa dimuat.','error');
 try{
  const {data:{user},error}=await sb.auth.getUser();if(error||!user)return redirectLogin();
  activeUser=user;
  const {data:profile,error:profileError}=await sb.from('users').select('role,nama_lengkap').eq('id_user',user.id).single();
  if(profileError||!profile)throw new Error('Akun tidak memiliki profil atau izin SELECT public.users: '+(profileError?.message||''));
  activeRole=profile.role||'Staff';const name=profile.nama_lengkap||user.email||'Pengguna';
  el('displayUserName').textContent=name;el('displayUserRole').textContent=activeRole;el('profilInisial').textContent=name.slice(0,1).toUpperCase();
  el('panelTindakLanjutLeader').style.display=canManageCases()?'':'none';
  el('view-detail-kasus').classList.toggle('staff-detail-centered',!canManageCases());
  el('btnSyncSheets').style.display=canManageCases()?'':'none';
  await loadCases();
 }catch(e){el('dashboardNotice').textContent=e.message;await notice('Profil belum siap',e.message,'error');}
}
async function syncSheetsNow(){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader/Admin dapat menjalankan sinkronisasi penuh.','warning');
 const btn=el('btnSyncSheets');if(btn){btn.disabled=true;btn.textContent='Sinkronisasi...';}
 try{
  const {data:{session},error}=await sb.auth.getSession();
  if(error||!session?.access_token)throw new Error('Sesi Supabase kedaluwarsa. Silakan masuk kembali.');
  const response=await fetch('/api/sheets-sync',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
   body:JSON.stringify({mode:'full'})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.message||'Sinkronisasi gagal.');
  await notice('Google Sheets diperbarui',`Kasus: ${result.counts.cases}, bukti: ${result.counts.evidence_files}, riwayat: ${result.counts.case_logs}.`,'success');
 }catch(e){await notice('Sinkronisasi gagal',e.message,'error');}
 finally{if(btn){btn.disabled=false;btn.textContent='Sinkronkan Google Sheets';}}
}
async function logout(){try{await sb?.auth.signOut();}catch(e){console.warn(e)}localStorage.removeItem('user_role');localStorage.removeItem('user_name');redirectLogin();}
function displayCases(){
 const q=el('searchCases').value.toLowerCase().trim(), filter=el('filterCaseStatus').value;
 const list=cachedCases.filter(c=>(!filter||toText(c.status_kasus||statuses[0])===filter)&&[c.id_kasus,c.sku_produk,c.nama_produk].some(x=>toText(x).toLowerCase().includes(q)));
 el('dashboardCasesBody').innerHTML=list.map(c=>`<tr class="border-b"><td class="py-3 pr-4"><button type="button" data-case-id="${htmlEscape(c.id_kasus)}" class="text-blue-600 font-semibold underline">${htmlEscape(c.id_kasus)}</button></td><td class="py-3 pr-4">${htmlEscape(c.nama_produk)}<span class="text-xs text-slate-400 block">${htmlEscape(c.sku_produk)}</span></td><td class="py-3 pr-4">${htmlEscape(c.selisih)}</td><td class="py-3"><span class="status-chip">${htmlEscape(c.status_kasus||statuses[0])}</span></td></tr>`).join('');
 el('dashboardNotice').textContent=list.length?`${list.length} kasus ditampilkan.`:(q||filter?'Tidak ada kasus yang cocok.':'Belum ada kasus yang dapat diakses.');
}
async function loadCases(){
 if(!sb||!activeUser)return;
 el('dashboardNotice').textContent='Memuat laporan...';
 const {data,error}=await sb.from('cases').select('*').order('created_at',{ascending:false}).limit(500);
 if(error){el('dashboardNotice').textContent='Gagal membaca kasus: '+error.message;return;}
 cachedCases=data||[];
 el('countTotal').textContent=cachedCases.length;
 el('countClosed').textContent=cachedCases.filter(c=>(c.status_kasus||statuses[0])==='Selesai').length;
 el('countOpen').textContent=cachedCases.filter(c=>(c.status_kasus||statuses[0])!=='Selesai').length;
 el('countEscalated').textContent=cachedCases.filter(c=>c.status_kasus==='Menunggu Tindak Lanjut IT/MD').length;
 displayCases();
}
async function openCase(id){
 selectedCase=cachedCases.find(c=>c.id_kasus===id)||null;
 if(!selectedCase)return notice('Kasus tidak ditemukan','Refresh daftar kasus lalu coba lagi.','warning');
 const c=selectedCase;el('detailTitle').textContent='Kasus: '+c.id_kasus;
 const pairs=[['ID kasus',c.id_kasus],['Produk',c.nama_produk],['SKU',c.sku_produk],['Stok sistem',c.stok_sistem],['Stok fisik',c.stok_fisik],['Selisih fisik−sistem',c.selisih],['Dugaan penyebab',c.dugaan_penyebab],['Kronologi',c.kronologi],['Status',c.status_kasus||statuses[0]],['Dibuat',niceDate(c.created_at)]];
 el('detailInfo').innerHTML='<dl class="grid grid-cols-1 sm:grid-cols-2 gap-3">'+pairs.map(([k,v])=>`<div class="bg-slate-50 p-3 rounded"><dt class="text-xs uppercase text-slate-500">${htmlEscape(k)}</dt><dd class="text-sm whitespace-pre-wrap break-words mt-1">${htmlEscape(v)}</dd></div>`).join('')+'</dl>';
 el('selectStatus').value=statuses.includes(c.status_kasus)?c.status_kasus:statuses[0];el('inputStatusNote').value='';
 el('detailEvidence').textContent='Memuat bukti...';el('detailHistory').textContent='Memuat riwayat...';
 showView('detail-kasus');
 await Promise.all([loadEvidence(id),loadHistory(id)]);
}
async function loadEvidence(id){
 const {data,error}=await sb.from('evidence_files').select('id_kasus,nama_file_asli,drive_file_id,waktu_unggah').eq('id_kasus',id).order('waktu_unggah',{ascending:false}).limit(150);
 if(selectedCase?.id_kasus!==id)return;
 if(error){el('detailEvidence').textContent='Gagal membaca bukti: '+error.message;return;}
 if(!data?.length){el('detailEvidence').textContent='Belum ada berkas. Gunakan Tambah Bukti di bawah ini.';return;}
 el('detailEvidence').innerHTML=data.map(f=>`<div class="bg-slate-50 rounded border p-3 mb-2 flex gap-3 justify-between items-center"><div class="break-all"><strong>${htmlEscape(f.nama_file_asli||'Berkas')}</strong><p class="text-xs text-slate-400">${htmlEscape(niceDate(f.waktu_unggah))}</p></div><button type="button" class="text-blue-700 underline text-xs" data-download-case="${htmlEscape(id)}" data-download-id="${htmlEscape(f.drive_file_id)}" data-download-name="${htmlEscape(f.nama_file_asli)}">Unduh aman</button></div>`).join('');
}
async function loadHistory(id){
 const {data,error}=await sb.from('case_logs').select('id_user,aksi,catatan,waktu_aksi').eq('id_kasus',id).order('waktu_aksi',{ascending:false}).limit(150);
 if(selectedCase?.id_kasus!==id)return;
 if(error){el('detailHistory').textContent='Gagal membaca riwayat: '+error.message;return;}
 if(!data?.length){el('detailHistory').textContent='Belum ada catatan tindak lanjut.';return;}
 const names={};if(canManageCases()){
  const ids=[...new Set(data.map(x=>x.id_user).filter(Boolean))];
  if(ids.length){const r=await sb.from('users').select('id_user,nama_lengkap').in('id_user',ids);if(!r.error)(r.data||[]).forEach(u=>names[u.id_user]=u.nama_lengkap);}
 }
 if(selectedCase?.id_kasus!==id)return;
 el('detailHistory').innerHTML=data.map(log=>`<div class="border-l-2 border-blue-300 pl-4 pb-3"><strong>${htmlEscape(log.aksi)}</strong><p class="text-xs text-slate-400">${htmlEscape(niceDate(log.waktu_aksi))} • ${htmlEscape(names[log.id_user]||(log.id_user===activeUser?.id?'Akun saya':'Pengguna tercatat'))}</p><p class="mt-1 break-words whitespace-pre-wrap">${htmlEscape(log.catatan)}</p></div>`).join('');
}
async function saveStatus(){
 if(!canManageCases())return notice('Akses tidak diizinkan','Hanya Leader/Admin.','warning');
 if(!selectedCase)return notice('Kasus belum dipilih','Buka kasus dari daftar.','warning');
 const status=el('selectStatus').value,note=el('inputStatusNote').value.trim(),id=selectedCase.id_kasus;
 if(!statuses.includes(status)||note.length<8)return notice('Data belum lengkap','Pilih status dan isi catatan minimal 8 karakter.','warning');
 const btn=el('btnSimpanStatus');btn.disabled=true;btn.textContent='Menyimpan...';
 try{
  const {data,error}=await sb.rpc('stocktrace_update_case_status',{p_case_id:id,p_status:status,p_note:note});
  if(error)throw new Error(error.message);
  if(!data?.ok)throw new Error('Database tidak mengonfirmasi perubahan.');
  await loadCases();await openCase(id);await notice('Berhasil','Status dan catatan tercatat secara bersamaan.','success');
 }catch(e){await notice('Belum dapat memperbarui',e.message,'error');}
 finally{btn.disabled=false;btn.textContent='Simpan status & catatan';}
}
function validateFiles(files){
 if(!files.length){notice('Bukti belum dipilih','Pilih foto, PDF, atau berkas lain dahulu.','warning');return false;}
 for(const f of files){
  const ext=toText(f.name).split('.').pop().toLowerCase();
  if(!allowedExtensions.has(ext)){notice('Tipe berkas tidak didukung',f.name,'warning');return false;}
  if(f.size<=0||f.size>4*1024*1024){notice('Ukuran berkas tidak sesuai',`${f.name}: tiap file harus 1 byte sampai 4 MB.`,'warning');return false;}
 }
 return true;
}
function makeCaseId(){const d=new Date();const s=String(d.getFullYear()).slice(-2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');const r=globalThis.crypto?.randomUUID?.()||('fallback'+Math.random().toString(36).slice(2)+Date.now());return 'ST-'+s+'-'+r.replaceAll('-','').slice(0,12);}
async function uploadToBackend(file,id,token){
 if(location.protocol==='file:')throw new Error('Upload hanya bisa dari alamat website Vercel.');
 const body=new FormData();body.append('bukti_file',file);body.append('id_kasus',id);
 const resp=await fetch('/api/upload',{method:'POST',body,headers:{Authorization:`Bearer ${token}`}});
 const content=await resp.text();let data;
 try{data=JSON.parse(content);}catch{throw new Error(`Endpoint /api/upload memberikan HTTP ${resp.status} non-JSON. Periksa log Vercel.`);}
 if(!resp.ok||!data?.success)throw new Error(data?.error||`Upload gagal (HTTP ${resp.status})`);
 if(!data.drive_file_id)throw new Error('Upload tidak menghasilkan ID file Google Drive.');
 return data;
}
async function uploadFiles(files,id,session,button){
 let count=0;const errors=[];
 for(const [i,file] of files.entries()){
  button.textContent=`Mengunggah ${i+1}/${files.length}...`;
  try{
   const d=await uploadToBackend(file,id,session.access_token);
   const {error}=await sb.from('evidence_files').insert([{id_kasus:id,nama_file_asli:file.name,drive_file_id:d.drive_file_id,drive_view_url:d.drive_link}]);
   if(error)throw new Error('File mungkin sudah masuk Drive, tetapi metadata gagal: '+error.message);
   count++;
   // Trigger database mencatat penambahan bukti secara otomatis.
  }catch(e){errors.push(file.name+': '+e.message);}
 }
 return {count,errors};
}
async function submitReport(ev){
 ev.preventDefault();if(!activeUser)return redirectLogin();
 const files=[...el('inputFile').files];if(!validateFiles(files))return;
 const sys=Number(el('inputSistem').value),fis=Number(el('inputFisik').value);
 if(!Number.isSafeInteger(sys)||!Number.isSafeInteger(fis)||sys<0||fis<0)return notice('Stok tidak valid','Masukkan bilangan bulat tidak negatif.','warning');
 if(sys===fis)return notice('Tidak ada selisih','Stok sistem dan stok fisik sama.','warning');
 const sku=el('inputSKU').value.trim(),name=el('inputNama').value.trim(),chrono=el('inputKronologi').value.trim();
 if(!sku||!name||chrono.length<8)return notice('Form belum lengkap','SKU, produk dan kronologi minimal 8 karakter wajib diisi.','warning');
 const {data:{session},error:authError}=await sb.auth.getSession();if(authError||!session)return redirectLogin();
 const id=makeCaseId(),btn=el('btnSubmitLaporan');let saved=false;btn.disabled=true;btn.textContent='Menyimpan kasus...';
 try{
  const {error}=await sb.from('cases').insert([{id_kasus:id,id_pelapor:activeUser.id,sku_produk:sku,nama_produk:name,stok_sistem:sys,stok_fisik:fis,selisih:fis-sys,dugaan_penyebab:el('inputPenyebab').value,kronologi:chrono,status_kasus:'Baru Dilaporkan'}]);
  if(error)throw new Error('Kasus gagal disimpan: '+error.message);
  saved=true;
  // Trigger database mencatat pembuatan laporan secara otomatis.
  const result=await uploadFiles(files,id,session,btn);
  el('formLaporanLengkap').reset();await loadCases();
  await notice(result.errors.length?'Sebagian bukti belum tersimpan':'Laporan berhasil',`Kasus ${id} tersimpan. Bukti berhasil ${result.count}/${files.length}. ${result.errors.length?result.errors.join('; ')+' — Periksa Drive sebelum mengulangi unggah.':'Silakan cek arsip dan riwayat.'}`,result.errors.length?'warning':'success');
  await openCase(id);
 }catch(e){await notice(saved?'Kasus tersimpan; bukti perlu dilengkapi':'Kasus belum disimpan',`${e.message}. ${saved?'ID kasus: '+id+'. Tambahkan bukti melalui Detail Kasus.':''}`,'error');if(saved){await loadCases();await openCase(id);}}
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
 el('archiveNotice').textContent='Memuat bukti arsip...';
 const {data,error}=await sb.from('evidence_files').select('id_kasus,nama_file_asli,drive_file_id,waktu_unggah').order('waktu_unggah',{ascending:false}).limit(500);
 if(error){el('archiveNotice').textContent='Gagal membaca arsip: '+error.message;return;}
 const cases=new Map(cachedCases.map(c=>[c.id_kasus,c]));
 el('archiveBody').innerHTML=(data||[]).map(f=>`<tr class="border-b"><td class="py-3 pr-4 break-all">${htmlEscape(f.nama_file_asli)}</td><td class="pr-4">${htmlEscape(f.id_kasus)}<span class="block text-xs text-slate-400">${htmlEscape(cases.get(f.id_kasus)?.nama_produk||'')}</span></td><td class="pr-4">${htmlEscape(niceDate(f.waktu_unggah))}</td><td><button class="text-blue-600 underline" data-download-case="${htmlEscape(f.id_kasus)}" data-download-id="${htmlEscape(f.drive_file_id)}" data-download-name="${htmlEscape(f.nama_file_asli)}">Unduh</button></td></tr>`).join('');
 el('archiveNotice').textContent=data?.length?`${data.length} berkas dapat diakses (maks. 500).`:'Belum ada berkas yang dapat diakses.';
}
function selectedReportCases(){const from=el('reportFrom').value,to=el('reportTo').value;return cachedCases.filter(c=>{const day=toText(c.created_at).slice(0,10);return (!from||(day&&day>=from))&&(!to||(day&&day<=to));});}
function reportBars(id,items,total){el(id).innerHTML=items.length?items.map(([label,n])=>`<div><div class="flex gap-2 justify-between text-sm"><span>${htmlEscape(label)}</span><strong>${n}</strong></div><div class="bg-slate-100 rounded-full overflow-hidden"><div class="bar" style="width:${total?Math.max(2,Math.round(100*n/total)):0}%"></div></div></div>`).join(''):'<p class="text-slate-400">Tidak ada data</p>';}
function renderReports(){const data=selectedReportCases();reportBars('reportStatusBars',statuses.map(s=>[s,data.filter(c=>(c.status_kasus||statuses[0])===s).length]),data.length);const map=new Map();data.forEach(c=>{const s=toText(c.sku_produk)||'(tanpa SKU)';map.set(s,(map.get(s)||0)+1);});reportBars('reportSkuBars',[...map].sort((a,b)=>b[1]-a[1]).slice(0,8),data.length);}
function clearReportDates(){el('reportFrom').value='';el('reportTo').value='';renderReports();}
function csv(v){let s=toText(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportCasesCSV(){const header=['ID Kasus','Tanggal','SKU','Produk','Stok Sistem','Stok Fisik','Selisih','Dugaan Penyebab','Kronologi','Status'];const rows=selectedReportCases().map(c=>[c.id_kasus,c.created_at,c.sku_produk,c.nama_produk,c.stok_sistem,c.stok_fisik,c.selisih,c.dugaan_penyebab,c.kronologi,c.status_kasus]);const text='\uFEFF'+[header,...rows].map(row=>row.map(csv).join(',')).join('\r\n');const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='StockTrace_Rekap_'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
function downloadClick(ev){const btn=ev.target.closest('button[data-download-id]');if(btn)downloadEvidence(btn.dataset.downloadCase,btn.dataset.downloadId,btn.dataset.downloadName);}
el('formLaporanLengkap').addEventListener('submit',submitReport);
el('formExtraEvidence').addEventListener('submit',addEvidenceToCase);
el('searchCases').addEventListener('input',displayCases);
el('filterCaseStatus').addEventListener('change',displayCases);
el('dashboardCasesBody').addEventListener('click',e=>{const btn=e.target.closest('button[data-case-id]');if(btn)openCase(btn.dataset.caseId);});
el('detailEvidence').addEventListener('click',downloadClick);
el('archiveBody').addEventListener('click',downloadClick);
checkAuth();
