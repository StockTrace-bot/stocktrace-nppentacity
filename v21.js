/* StockTrace V2.1 — separate academic intake & cashier request workflows.
 * Depends on app.js, xlsx-export.js; uses existing Supabase session and Drive control.
 * No official inventory/cashier integration and never mutates official stock quantities.
 */
let v21Intakes=[],v21Items=[],v21IntakeEvidence=[],v21Cashier=[],v21SelectedIntake=null,v21SelectedCashier=null;
const cashierStatuses=['Diajukan','Diteruskan ke Kasir','Sedang Diproses','Selesai (Dikonfirmasi)','Ditolak'];
const v21Int=id=>{const v=Number(id.value);return id.value!==''&&Number.isSafeInteger(v)&&v>=0&&v<=999999999?v:null;};
function v21DateBalikpapan(){const ps=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${ps.year}-${ps.month}-${ps.day}`;}
function v21Row(){
 const tr=document.createElement('tr');tr.innerHTML=`<td><input aria-label="SKU" data-field="sku" class="st-field" maxlength="80" required placeholder="NP-..."/></td>
 <td><input aria-label="Nama produk" data-field="product_name" class="st-field" maxlength="150" required placeholder="Nama barang"/></td>
 <td><input aria-label="Jumlah dokumen" data-field="qty_document" type="number" class="st-field" min="0" max="999999999" step="1" value="0" required/></td>
 <td><input aria-label="Jumlah fisik diterima" data-field="qty_received" type="number" class="st-field" min="0" max="999999999" step="1" value="0" required/></td>
 <td><strong data-field="difference" class="text-slate-700">0</strong></td><td><button type="button" class="st-inline-action" data-remove-row="1">Hapus</button></td>`;
 el('intakeItemsBody').appendChild(tr);return tr;
}
function v21UpdateRowDiff(row){const a=v21Int(row.querySelector('[data-field="qty_document"]'));const b=v21Int(row.querySelector('[data-field="qty_received"]'));row.querySelector('[data-field="difference"]').textContent=a===null||b===null?'—':String(b-a);}
function v21CollectRows(){const rows=[...el('intakeItemsBody').rows].map(row=>({sku:row.querySelector('[data-field="sku"]').value.trim(),product_name:row.querySelector('[data-field="product_name"]').value.trim(),qty_document:v21Int(row.querySelector('[data-field="qty_document"]')),qty_received:v21Int(row.querySelector('[data-field="qty_received"]'))}));
 if(!rows.length||rows.length>150)throw Error('Isi minimal 1, maksimal 150 SKU.');
 const keys=new Set();for(const r of rows){const key=r.sku.toUpperCase();if(!r.sku||r.sku.length>80||r.product_name.length<2||r.qty_document===null||r.qty_received===null)throw Error('Lengkapi SKU, nama produk (minimal 2 huruf) dan kedua jumlah yang valid.');if(keys.has(key))throw Error('SKU duplikat pada satu dokumen: '+r.sku+'. Gabungkan ke satu baris.');keys.add(key);}
 return rows;
}
async function v21ReadPaged(table,sortKey='created_at',max=5000){
 const rows=[],batch=500;for(let start=0;start<max;start+=batch){
  const {data,error}=await sb.from(table).select('*').order(sortKey,{ascending:false}).range(start,start+batch-1);
  if(error)throw Error('Tabel '+table+' belum siap atau akses ditolak: '+error.message+' (cek SQL 10 V2.1 staging).');
  rows.push(...(data||[]));if(!data||data.length<batch)break;
 }
 return {rows,truncated:rows.length===max};
}
async function loadIntakes(){
 if(!activeUser||mustChangePassword)return;
 el('intakeNotice').textContent='Memuat penerimaan & rincian...';
 try{
  const [headers,items,evid]=await Promise.all([v21ReadPaged('stocktrace_intakes'),v21ReadPaged('stocktrace_intake_items','id_intake'),v21ReadPaged('stocktrace_intake_evidence','waktu_unggah')]);
  v21Intakes=headers.rows;v21Items=items.rows;v21IntakeEvidence=evid.rows;
  v21RenderIntakes();el('intakeNotice').textContent=`${v21Intakes.length} dokumen, ${v21Items.length} baris SKU. ${headers.truncated||items.truncated||evid.truncated?'Batas 5.000 baris tercapai; ekspor hanya data yang termuat.':''}`;
  if(v21SelectedIntake)v21OpenIntake(v21SelectedIntake);
 }catch(e){el('intakeNotice').textContent='Gagal memuat penerimaan: '+e.message;}
}
function v21RenderIntakes(){
 const html=v21Intakes.map(h=>{
  const list=v21Items.filter(x=>x.id_intake===h.id_intake);
  const diff=list.filter(x=>x.qty_difference!==0).length;
  const count=list.reduce((sum,x)=>sum+Math.abs(x.qty_difference||0),0);
  return `<tr><td><strong>${htmlEscape(h.id_intake)}</strong><div class="text-xs text-slate-500">${htmlEscape(h.received_on)}</div></td>
   <td>${htmlEscape(h.document_no)}<div class="text-xs text-slate-500">${htmlEscape(h.supplier)}</div></td>
   <td>${list.length} SKU</td><td>${diff} SKU (total absolut ${count})</td><td>${htmlEscape(displayPerson(h.created_by))}</td>
   <td><button type="button" class="st-inline-action" data-open-intake="${htmlEscape(h.id_intake)}">Buka</button></td></tr>`;
 }).join('');
 el('intakesBody').innerHTML=html||'<tr><td colspan="6" class="text-slate-500">Belum ada penerimaan.</td></tr>';
}
function v21OpenIntake(id){
 v21SelectedIntake=id;const h=v21Intakes.find(x=>x.id_intake===id);if(!h)return;
 const items=v21Items.filter(x=>x.id_intake===id);const files=v21IntakeEvidence.filter(x=>x.id_intake===id);
 const lines=items.map(x=>`<tr><td>${htmlEscape(x.sku)}</td><td>${htmlEscape(x.product_name)}</td><td>${x.qty_document}</td><td>${x.qty_received}</td><td><strong>${x.qty_difference>0?'+':''}${x.qty_difference}</strong></td></tr>`).join('');
 const links=files.map(f=>`<div class="text-xs py-2 border-b flex justify-between gap-3"><span class="break-all">${htmlEscape(f.nama_file_asli)} · ${htmlEscape(niceDate(f.waktu_unggah))}</span><button type="button" class="st-inline-action" data-download-case="${htmlEscape(id)}" data-download-id="${htmlEscape(f.drive_file_id)}" data-download-name="${htmlEscape(f.nama_file_asli)}">Unduh</button></div>`).join('');
 el('intakeDetail').innerHTML=`<div class="st-detail-box space-y-3"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">Rincian ${htmlEscape(id)}</h3><button type="button" class="st-inline-action" data-close-intake="1">Tutup</button></div>
 <p class="text-xs">Dokumen: <strong>${htmlEscape(h.document_no)}</strong> · Tanggal: ${htmlEscape(h.received_on)} · Pengirim: ${htmlEscape(h.supplier)} · Dicatat: ${htmlEscape(niceDate(h.created_at))}</p>
 <p class="text-xs whitespace-pre-wrap">Catatan: ${htmlEscape(h.note||'—')}</p><div class="st-data-table overflow-x-auto"><table class="st-entry-table w-full text-sm"><thead><tr><th>SKU</th><th>Produk</th><th>Dokumen</th><th>Diterima</th><th>Selisih</th></tr></thead><tbody>${lines}</tbody></table></div>
 <h4 class="font-semibold text-sm">Bukti penerimaan (${files.length})</h4>${links||'<p class="text-xs text-slate-500">Belum ada lampiran.</p>'}
 <div class="border-t pt-3 space-y-2"><label class="st-field-label" for="intakeDetailFiles">Tambah bukti setelah dokumen disimpan</label><input id="intakeDetailFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.mp4,.webm,.doc,.docx,.xls,.xlsx,.csv,.txt" class="st-field"/><p id="intakeDetailProgress" class="text-xs text-blue-700" role="status" aria-live="polite"></p><button type="button" class="st-secondary-btn" data-upload-intake="${htmlEscape(id)}">Unggah lampiran</button></div>
 <button type="button" class="st-primary-btn" data-intake-to-cashier="${htmlEscape(id)}">Buat permintaan stok kasir terkait</button></div>`;
}
async function v21AttachFiles(files,id,progress){
 if(!files.length)return {count:0,errors:[]};
 if(!validateFiles(files))throw Error('Pemeriksaan berkas gagal.');
 const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error('Sesi login berakhir.');
 let count=0;const errors=[];
 for(const [i,file] of files.entries()){
  try{
   if(progress)progress.textContent=`Mengunggah ${i+1}/${files.length}: ${file.name}...`;
   const data=await uploadToBackend(file,id,session.access_token,pct=>{if(progress)progress.textContent=`${file.name}: ${pct}%`;});
   const {error}=await sb.from('stocktrace_intake_evidence').insert([{id_intake:id,nama_file_asli:file.name,drive_file_id:data.drive_file_id,drive_view_url:data.drive_link}]);
   if(error)throw Error('File mungkin berhasil masuk Drive namun metadata gagal: '+error.message);
   count++;
  }catch(e){errors.push(file.name+': '+e.message);}
 }
 if(progress)progress.textContent=`${count}/${files.length} lampiran dicatat. ${errors.length?'Periksa Drive sebelum mencoba upload ulang.':''}`;
 return {count,errors};
}
async function v21SaveIntake(event){
 event.preventDefault();if(!activeUser||mustChangePassword)return;
 let items;try{items=v21CollectRows();}catch(e){return notice('Rincian belum lengkap',e.message,'warning');}
 const date=el('intakeDate').value,document_no=el('intakeDoc').value.trim(),supplier=el('intakeSupplier').value.trim(),note=el('intakeNote').value.trim();
 if(document_no.length<2||supplier.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(date))return notice('Data dokumen belum lengkap','Isi nomor dokumen, tanggal dan sumber barang.','warning');
 const files=[...el('intakeFile').files];if(files.length&&!validateFiles(files))return;
 const button=el('btnSaveIntake');button.disabled=true;button.textContent='Menyimpan...';
 try{
  const {data,error}=await sb.rpc('stocktrace_create_intake',{p_document_no:document_no,p_received_on:date,p_supplier:supplier,p_note:note,p_items:items});
  if(error)throw Error(error.message);if(!data?.ok||!data.id_intake)throw Error('Penerimaan belum dikonfirmasi database.');
  const id=data.id_intake;
  // The document is committed atomically BEFORE optional media upload. Failure cannot erase document.
  let upload={count:0,errors:[]};if(files.length)upload=await v21AttachFiles(files,id,el('intakeUploadProgress'));
  el('formIntake').reset();el('intakeItemsBody').replaceChildren();v21Row();el('intakeDate').value=v21DateBalikpapan();
  await loadIntakes();v21OpenIntake(id);
  await notice(upload.errors.length?'Dokumen tersimpan, sebagian bukti gagal':'Penerimaan tersimpan',`ID ${id}. ${items.length} SKU. ${files.length?`Lampiran ${upload.count}/${files.length}.`:''} ${upload.errors.join('; ')} ${upload.errors.length?'Periksa Drive sebelum mencoba ulang.':''}`,upload.errors.length?'warning':'success');
 }catch(e){await notice('Gagal menyimpan penerimaan',e.message,'error');}
 finally{button.disabled=false;button.textContent='Simpan penerimaan';}
}
function v21Export(){
 if(!v21Intakes.length&&!v21Cashier.length)return notice('Belum ada data','Buka penerimaan dan kasir, kemudian muat data terlebih dahulu.','warning');
 if(!globalThis.StockTraceXlsx?.save)return notice('Ekspor belum siap','Modul XLSX tidak termuat.','error');
 const details=v21Items.filter(x=>v21Intakes.some(h=>h.id_intake===x.id_intake));
 const sheets=[
  {name:'Penerimaan',rows:[['ID Penerimaan','No Dokumen','Tanggal Terima','Pengirim','Catatan','Pembuat','Waktu Dibuat'],...v21Intakes.map(h=>[h.id_intake,h.document_no,h.received_on,h.supplier,h.note,displayPerson(h.created_by),niceDate(h.created_at)])]},
  {name:'Detail SKU',rows:[['ID Penerimaan','SKU','Nama Produk','Qty Dokumen','Qty Fisik','Selisih Fisik - Dokumen','Hasil'],...details.map(i=>[i.id_intake,i.sku,i.product_name,i.qty_document,i.qty_received,i.qty_difference,i.qty_difference===0?'Sesuai':i.qty_difference<0?'Kurang':'Lebih'])]},
  {name:'Permintaan Kasir',rows:[['ID Permintaan','SKU','Nama Produk','Qty Sistem','Qty Fisik','Selisih','Alasan','Status','Kasus R1','ID Penerimaan','Pemohon','Dibuat','Pembaruan'],...v21Cashier.map(r=>[r.id_request,r.sku,r.product_name,r.qty_system,r.qty_physical,r.qty_difference,r.reason,r.status_request,r.id_kasus||'',r.id_intake||'',displayPerson(r.created_by),niceDate(r.created_at),niceDate(r.updated_at)])]},
  {name:'Keterangan',rows:[['StockTrace V2.1 — Simulasi Akademik'],['Rangkuman berdasarkan data yang termuat sesuai hak akses akun dan batas pemuatan aplikasi.'],['Selisih penerimaan = jumlah fisik diterima - jumlah dokumen (positif: lebih, negatif: kurang).'],['Permintaan update stok kasir hanya untuk pencatatan/pemantauan, tidak mengubah sistem kasir.'],['Format .xlsx ini format kerja StockTrace; belum diverifikasi identik dengan template kantor pusat.'],['Dibuat (WITA)',niceDate(new Date().toISOString())]]}
 ];
 try{StockTraceXlsx.save(sheets,'StockTrace_Penerimaan_Kasir_'+v21DateBalikpapan()+'.xlsx');}
 catch(e){notice('Ekspor XLSX gagal',e.message,'error');}
}
async function loadCashier(){
 if(!activeUser||mustChangePassword)return;
 el('cashierNotice').textContent='Memuat permintaan update stok...';
 try{const data=await v21ReadPaged('stocktrace_cashier_requests');v21Cashier=data.rows;v21RenderCashier();el('cashierNotice').textContent=`${v21Cashier.length} permintaan termuat. ${data.truncated?'Batas 5.000 baris tercapai.':''}`;if(v21SelectedCashier)await v21OpenCashier(v21SelectedCashier);}
 catch(e){el('cashierNotice').textContent='Gagal memuat permintaan: '+e.message;}
}
function v21RenderCashier(){
 const f=el('cashierFilter').value,list=v21Cashier.filter(r=>!f||r.status_request===f);
 el('cashierTotal').textContent=v21Cashier.length;
 el('cashierWaiting').textContent=v21Cashier.filter(x=>['Diajukan','Diteruskan ke Kasir'].includes(x.status_request)).length;
 el('cashierProcess').textContent=v21Cashier.filter(x=>x.status_request==='Sedang Diproses').length;
 el('cashierDone').textContent=v21Cashier.filter(x=>x.status_request==='Selesai (Dikonfirmasi)').length;
 el('cashierBody').innerHTML=list.map(r=>`<tr><td><strong>${htmlEscape(r.id_request)}</strong><div class="text-xs text-slate-500">${htmlEscape(r.sku)} · ${htmlEscape(r.product_name)}</div></td><td>${r.qty_difference>0?'+':''}${r.qty_difference}</td><td><span class="status-chip">${htmlEscape(r.status_request)}</span></td><td>${htmlEscape(displayPerson(r.created_by))}</td><td>${htmlEscape(niceDate(r.created_at))}</td><td><button type="button" data-open-cashier="${htmlEscape(r.id_request)}" class="st-inline-action">Detail</button></td></tr>`).join('')||'<tr><td colspan="6" class="text-slate-500">Belum ada permintaan untuk filter ini.</td></tr>';
}
async function v21OpenCashier(id){
 v21SelectedCashier=id;const r=v21Cashier.find(x=>x.id_request===id);if(!r)return;
 const {data,error}=await sb.from('stocktrace_cashier_logs').select('action,note,id_user,created_at').eq('id_request',id).order('created_at',{ascending:false}).limit(150);
 const history=error?'<p class="text-xs text-red-700">Gagal membaca riwayat: '+htmlEscape(error.message)+'</p>':(data||[]).map(x=>`<div class="border-l-2 border-blue-300 pl-3 py-1 mb-3 text-xs"><strong>${htmlEscape(x.action)}</strong><p>${htmlEscape(niceDate(x.created_at))} · ${htmlEscape(displayPerson(x.id_user))}</p><p class="whitespace-pre-wrap">${htmlEscape(x.note)}</p></div>`).join('')||'<p class="text-xs">Belum ada riwayat.</p>';
 const management=canManageCases()?`<div class="border-t pt-3 space-y-2"><h4 class="font-semibold text-sm">Tindak lanjut Leader</h4><label class="st-field-label" for="cashierStatus">Ubah status monitoring</label><select id="cashierStatus" class="st-field">${cashierStatuses.map(s=>`<option ${s===r.status_request?'selected':''}>${htmlEscape(s)}</option>`).join('')}</select><label class="st-field-label" for="cashierStatusNote">Catatan wajib (minimal 8 karakter)</label><textarea id="cashierStatusNote" class="st-field" rows="3" maxlength="2000"></textarea><button type="button" class="st-primary-btn" data-save-cashier="${htmlEscape(id)}">Simpan status & riwayat</button></div>`:'';
 el('cashierDetail').innerHTML=`<div class="st-detail-box space-y-3"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">${htmlEscape(id)} — ${htmlEscape(r.sku)}</h3><button type="button" data-close-cashier="1" class="st-inline-action">Tutup</button></div>
 <div class="text-xs grid grid-cols-1 md:grid-cols-2 gap-3"><p>Nama: ${htmlEscape(r.product_name)}<br>Kasir: ${r.qty_system} · Fisik: ${r.qty_physical} · Selisih: ${r.qty_difference}</p><p>Kasus R1: ${htmlEscape(r.id_kasus||'—')}<br>Penerimaan: ${htmlEscape(r.id_intake||'—')}<br>Status: ${htmlEscape(r.status_request)}</p></div>
 <p class="text-xs whitespace-pre-wrap">Alasan: ${htmlEscape(r.reason)}</p><h4 class="font-semibold text-sm">Riwayat permintaan</h4>${history}${management}</div>`;
}
async function v21SaveCashier(event){
 event.preventDefault();const system=v21Int(el('cashierSystem')),physical=v21Int(el('cashierPhysical'));
 if(system===null||physical===null||system===physical)return notice('Jumlah belum valid','Jumlah harus bulat, tidak negatif, dan menunjukkan selisih.','warning');
 const id=el('cashierCase').value.trim(),intake=el('cashierIntake').value.trim(),sku=el('cashierSku').value.trim(),prod=el('cashierProduct').value.trim(),reason=el('cashierReason').value.trim();
 if(!sku||prod.length<2||reason.length<8)return notice('Form belum lengkap','Isi SKU, nama produk, dan alasan minimal 8 karakter.','warning');
 const btn=el('btnSubmitCashier');btn.disabled=true;btn.textContent='Mengirim...';
 try{
  const {data,error}=await sb.rpc('stocktrace_request_cashier_update',{p_sku:sku,p_product:prod,p_system_qty:system,p_counted_qty:physical,p_reason:reason,p_case_id:id||null,p_intake_id:intake||null});
  if(error)throw Error(error.message);if(!data?.ok)throw Error('Database belum mengonfirmasi permintaan.');
  el('formCashierRequest').reset();await loadCashier();await v21OpenCashier(data.id_request);
  await notice('Permintaan dibuat',`ID ${data.id_request} tersimpan dan menunggu tindak lanjut; stok kasir resmi tidak berubah.`,'success');
 }catch(e){await notice('Permintaan tidak tersimpan',e.message,'error');}
 finally{btn.disabled=false;btn.textContent='Kirim permintaan';}
}
async function v21UpdateCashier(id){
 if(!canManageCases())return notice('Akses ditolak','Hanya Leader/Admin.','warning');
 const status=el('cashierStatus').value,note=el('cashierStatusNote').value.trim();
 if(!cashierStatuses.includes(status)||note.length<8)return notice('Catatan wajib','Isi minimal 8 karakter sebelum memperbarui status.','warning');
 const btn=el('cashierDetail').querySelector('[data-save-cashier]');btn.disabled=true;
 try{
  const {data,error}=await sb.rpc('stocktrace_update_cashier_status',{p_request_id:id,p_status:status,p_note:note});
  if(error)throw Error(error.message);if(!data?.ok)throw Error('Perubahan belum dikonfirmasi.');
  await loadCashier();await notice('Status tersimpan','Perubahan status dan catatan ditambahkan ke riwayat. Tidak ada perubahan otomatis ke kasir resmi.','success');
 }catch(e){await notice('Gagal menyimpan status',e.message,'error');}
 finally{btn.disabled=false;}
}
// Independent event wiring: all menu visibility remains controlled by app.js showView().
el('btnAddIntakeRow').addEventListener('click',()=>{if(el('intakeItemsBody').rows.length>=150)return notice('Batas SKU','Maksimal 150 SKU per dokumen.','warning');v21Row();});
el('intakeItemsBody').addEventListener('click',e=>{if(e.target.closest('[data-remove-row]')){e.target.closest('tr').remove();if(!el('intakeItemsBody').rows.length)v21Row();}});
el('intakeItemsBody').addEventListener('input',e=>{const row=e.target.closest('tr');if(row)v21UpdateRowDiff(row);});
el('formIntake').addEventListener('submit',v21SaveIntake);
el('btnRefreshIntakes').addEventListener('click',loadIntakes);
el('btnExportIntake').addEventListener('click',async()=>{await Promise.all([loadIntakes(),loadCashier()]);v21Export();});
el('intakesBody').addEventListener('click',e=>{const btn=e.target.closest('[data-open-intake]');if(btn)v21OpenIntake(btn.dataset.openIntake);});
el('intakeDetail').addEventListener('click',async e=>{
 const target=e.target.closest('button');if(!target)return;
 if(target.dataset.closeIntake){v21SelectedIntake=null;el('intakeDetail').replaceChildren();return;}
 if(target.dataset.downloadId){downloadClick(e);return;}
 if(target.dataset.intakeToCashier){showView('cashier');el('cashierIntake').value=target.dataset.intakeToCashier;return;}
 if(target.dataset.uploadIntake){const files=[...el('intakeDetailFiles').files];if(!files.length)return notice('Pilih bukti','Pilih berkas dahulu.','warning');target.disabled=true;
  try{const r=await v21AttachFiles(files,target.dataset.uploadIntake,el('intakeDetailProgress'));await loadIntakes();await notice(r.errors.length?'Unggah sebagian':'Bukti tersimpan',`${r.count}/${files.length} bukti dicatat. ${r.errors.join('; ')}` ,r.errors.length?'warning':'success');}
  catch(err){await notice('Unggah gagal',err.message,'error');}finally{target.disabled=false;}
 }
});
el('formCashierRequest').addEventListener('submit',v21SaveCashier);
el('btnRefreshCashier').addEventListener('click',loadCashier);
el('cashierFilter').addEventListener('change',v21RenderCashier);
el('cashierBody').addEventListener('click',e=>{const btn=e.target.closest('[data-open-cashier]');if(btn)v21OpenCashier(btn.dataset.openCashier);});
el('cashierDetail').addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;if(t.dataset.closeCashier){v21SelectedCashier=null;el('cashierDetail').replaceChildren();}else if(t.dataset.saveCashier)v21UpdateCashier(t.dataset.saveCashier);});
if(!el('intakeItemsBody').rows.length)v21Row();el('intakeDate').value=v21DateBalikpapan();
