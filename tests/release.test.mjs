import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8'),bundle=fs.readFileSync('assets/app-bundle.js','utf8'),css=fs.readFileSync('assets/style.css','utf8'),sql=fs.readFileSync('sql/17_VERIFIED_OPENING_BALANCES.sql','utf8');
test('consolidated browser runtime parses as a single classic script',()=>{assert.doesNotThrow(()=>new vm.Script(bundle));assert.equal((html.match(/src="assets\/app-bundle\.js\?v=4\.2\.0"/g)||[]).length,1);assert.equal((html.match(/href="assets\/style\.css\?v=4\.2"/g)||[]).length,1);});
test('public legal paths retain routing and actual target files',()=>{const v=JSON.parse(fs.readFileSync('vercel.json'));for(const page of ['about.html','privacy.html','terms.html']){const r=v.rewrites.find(x=>x.source==='/'+page);assert.ok(r);assert.ok(fs.existsSync('.'+r.destination));}});
test('opening balances append verifications and block direct authenticated writes',()=>{assert.match(sql,/REVOKE ALL ON public\.st_opening_balances FROM PUBLIC,anon,authenticated/);assert.match(sql,/GRANT SELECT ON public\.st_opening_balances TO authenticated/);assert.match(sql,/st_verify_opening[\s\S]*?stocktrace_v21_member\(\)[\s\S]*?stocktrace_is_leader\(\)[\s\S]*?INSERT INTO public\.st_opening_balances/);assert.doesNotMatch(sql,/UPDATE public\.st_opening_balances/);});
test('balance is null until verified; archived intake and voided sales excluded',()=>{assert.match(sql,/CASE WHEN o\.id IS NOT NULL THEN o\.qty\+a\.n-b\.n\+c\.n END/);assert.match(sql,/h\.deleted_at IS NULL AND i\.deleted_at IS NULL/);assert.match(sql,/h\.voided_at IS NULL/);assert.match(sql,/r\.status='approved' AND r\.condition='layak'/);assert.match(bundle,/belum ditetapkan/i);});
test('Leader opening panel controls exist and hidden attribute wins panel styling',()=>{for(const id of ['retailBalancePanel','retailOpeningForm','retailProductDetail','retailOpeningSave'])assert.match(html,new RegExp('id="'+id+'"'));assert.match(bundle,/retailBalancePanel'\)\.hidden=!canManageCases\(\)/);assert.match(css,/\.st-retail-panel\[hidden\][\s\S]*?display:\s*none\s*!important/);});
test('opening balance sheet is included in sales target',()=>{const api=fs.readFileSync('api/sheets-sync.mjs','utf8');assert.match(api,/st_opening_balances: \{tab:'Saldo Awal'/);assert.match(api,/sales: \{spreadsheetTarget:'sales',tables:\[[^\]]*'st_opening_balances'/);});

 test('operational panels keep calculation notes collapsed and retain stock warning',()=>{for(const title of ['Cara menghitung omzet','Cara menghitung pergerakan barang','Cara menghitung estimasi stok'])assert.ok(html.includes('<summary class="cursor-pointer">'+title+'</summary>'));assert.doesNotMatch(html,/<p class="text-sm">(?:Bukan saldo stok resmi|Isi stok fisik sebelum transaksi)/);assert.match(bundle,/estimated_qty!=null&&Number\(r\.estimated_qty\)<0/);});

test('one inspection entry; no separate correction form or duplicate menu',()=>{
 const sidebar=html.match(/<aside id="appSidebar"[\s\S]*?<\/aside>/)[0];
 assert.match(sidebar,/data-nav-view="products"[\s\S]*?Persediaan &amp; Pelaporan/);assert.doesNotMatch(sidebar,/data-nav-view="cases"/);assert.match(html,/data-workspace-view="cases"/);
 assert.doesNotMatch(sidebar,/data-nav-view="cashier"|data-nav-view="form-laporan"/);
 for(const id of ['view-cases','view-form-laporan','view-cashier','caseCorrectionDetail','btnCaseCorrection','retailTopScan'])assert.ok(html.includes('id="'+id+'"'));
 for(const id of ['formCashierRequest','cashierSku','retailCashierScan','retailMasterIntakeScan','retailNewProduct'])assert.ok(!html.includes('id="'+id+'"'));
 assert.match(bundle,/caseCorrectionDetail'\)\.append\(el\('cashierDetail'\)\)/);
 assert.match(bundle,/retailRpc\('stocktrace_request_cashier_update',\{p_sku:c\.sku_produk,p_product:c\.nama_produk,p_system_qty:c\.stok_sistem,p_counted_qty:c\.stok_fisik/);
});
test('receipt inspection reuses source and leaves POS and physical counts blank',async()=>{
 const f=bundle.slice(bundle.indexOf('let caseSourceIntake='),bundle.indexOf("el('btnCaseCorrection').addEventListener"));
 const fields=new Map(),views=[],opened=[];let prior=[];
 const el=id=>{if(!fields.has(id))fields.set(id,{value:'',files:[],focus(){},reset(){for(const x of fields.values())x.value='';}});return fields.get(id);};
 const ctx=vm.createContext({el,activeUser:{id:'a'},mustChangePassword:false,retailFindCode:async()=>({sku:'B',name:'Rok'}),retailRead:async()=>prior,loadCases:async()=>{},openCase:async id=>opened.push(id),retailApplyProduct:async p=>{el('inputSKU').value=p.sku;el('inputNama').value=p.name;},showView:v=>views.push(v),window:{confirm:()=>true},notice(){throw Error('Unexpected notice');}});
 vm.runInContext(f,ctx);await vm.runInContext("prepareStockCorrection({sku:'B',name:'Rok',intake:'IN-1'})",ctx);
 assert.equal(el('inputSKU').value,'B');assert.equal(el('inputNama').value,'Rok');assert.equal(el('inputSistem').value,'');assert.equal(el('inputFisik').value,'');assert.equal(vm.runInContext('caseSourceIntake',ctx),'IN-1');assert.equal(el('inputSKU').readOnly,true);assert.equal(views[0],'form-laporan');
 prior=[{id_kasus:'ST-1'}];await vm.runInContext("prepareStockCorrection({sku:'B',intake:'IN-1'})",ctx);assert.deepEqual(opened,['ST-1']);assert.equal(views.length,1);
});
test('manual registration and catalogue shortcut do not count stock until receipt saved',()=>{
 const f=bundle.slice(bundle.indexOf('async function retailApplyProduct('),bundle.indexOf('function retailCartTotals('));
 assert.match(f,/target==='intake-from-master'/);assert.match(f,/showView\('intake'\);target='intake-register'/);assert.doesNotMatch(f,/stocktrace_create_intake|retailRpc\(/);assert.match(bundle,/retailDetailReceive/);assert.match(f,/if\(target==='intake'\)input\.value=retailInt/);
 assert.match(bundle,/retailOpenProduct\(null,'','intake-register'\)/);
});
test('receipt reference is durable and inherited by correction; no duplicate open inspection',()=>{
 const m=fs.readFileSync('sql/19_LINK_INTAKE_INSPECTION.sql','utf8');assert.match(m,/ADD COLUMN IF NOT EXISTS source_intake_id text REFERENCES public\.stocktrace_intakes/);assert.match(m,/upper\(btrim\(i\.sku\)\)=upper\(btrim\(NEW\.sku_produk\)\)/);assert.match(m,/GRANT INSERT \(source_intake_id\) ON public\.cases TO authenticated/);assert.match(m,/CREATE UNIQUE INDEX IF NOT EXISTS st_one_open_inspection_per_intake_sku/);assert.match(m,/NEW\.id_intake:=origin/);assert.match(m,/BEFORE INSERT ON public\.stocktrace_cashier_requests/);assert.doesNotMatch(m,/DROP TABLE|TRUNCATE|DELETE FROM/i);assert.match(bundle,/source_intake_id:caseSourceIntake\|\|null/);
});
test('inventory and sales reports each have one home',()=>{
 const inventory=html.slice(html.indexOf('id="view-products"'),html.indexOf('id="view-sales"'));
 const reports=html.slice(html.indexOf('id="view-reports"'),html.indexOf('id="view-intake"'));
 for(const id of ['retailProductRows','retailProductDetail'])assert.ok(inventory.includes('id="'+id+'"'));
 for(const id of ['retailMovementRows','btnExportIntake'])assert.ok(reports.includes('id="'+id+'"'));
 const sales=html.slice(html.indexOf('id="view-sales"'),html.indexOf('id="retailScanDialog"'));for(const id of ['retailSalesSummary','retailHistory'])assert.ok(sales.includes('id="'+id+'"'));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
});

test('integrated workflow uses database constraints and atomic report/correction linking',()=>{
 const migration=fs.readFileSync('sql/18_INTEGRATED_STOCK_WORKFLOW.sql','utf8');
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS st_one_active_correction_per_sku/);
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS st_one_active_correction_per_case/);
 assert.match(migration,/SELECT \* INTO p FROM public\.st_products[\s\S]*?FOR UPDATE/);
 assert.match(migration,/INSERT INTO public\.cases[\s\S]*?INSERT INTO public\.stocktrace_cashier_requests/);
 assert.match(migration,/c\.stok_sistem<>p_system_qty OR c\.stok_fisik<>p_counted_qty/);
 assert.match(migration,/BEFORE UPDATE OF status_kasus,deleted_at ON public\.cases/);
 assert.match(migration,/AFTER INSERT OR UPDATE OF status_request,deleted_at ON public\.stocktrace_cashier_requests/);
 assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
test('receipt retry uses the same key and does not re-upload evidence on replay',()=>{
 const migration=fs.readFileSync('sql/18_INTEGRATED_STOCK_WORKFLOW.sql','utf8');
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS st_intake_request_key_unique/);
 assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_request_key::text,0\)\)/);
 assert.match(migration,/v_prior\.request_fingerprint IS DISTINCT FROM v_fingerprint/);
 assert.match(migration,/'replayed',true/);
 assert.match(bundle,/intakeRequestKey \|\|= crypto\.randomUUID\(\)/);
 assert.match(bundle,/files\.length&&!data\.replayed/);
 assert.match(bundle,/savedId=id/);
});
test('product identity and balance stay independent from official POS correction',()=>{
 const migration=fs.readFileSync('sql/18_INTEGRATED_STOCK_WORKFLOW.sql','utf8');
 assert.match(migration,/BEFORE INSERT ON public\.cases/);
 assert.match(migration,/BEFORE INSERT ON public\.stocktrace_intake_items/);
 assert.match(migration,/o\.qty\+a\.n-b\.n\+c\.n/);
 assert.match(bundle,/retailDetailCheck/);
 assert.match(bundle,/Estimasi stok:/);
 assert.match(bundle,/p_system_qty:c\.stok_sistem,p_counted_qty:c\.stok_fisik/);
 assert.match(bundle,/loadLinkedCorrection\(id\)/);
 assert.doesNotMatch(migration,/UPDATE public\.st_opening_balances/);
});


test('V4 one sync action attempts every target even if one target fails',async()=>{
 const calls=[],messages=[],btn={};const code=bundle.slice(bundle.indexOf('async function syncSheetsNow(){'),bundle.indexOf('async function logout()'));
 const ctx=vm.createContext({canManageCases:()=>true,el:()=>btn,notice:async(...a)=>messages.push(a),sb:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}},fetch:async(url,o)=>{const mode=JSON.parse(o.body).mode;calls.push(mode);return {ok:mode!=='full',json:async()=>({ok:mode!=='full',counts:{},message:'uji gagal'})};}});
 vm.runInContext(code,ctx);await vm.runInContext('syncSheetsNow()',ctx);assert.deepEqual(calls,['full','full_penerimaan','full_penjualan']);assert.equal(btn.disabled,false);assert.match(messages[0][0],/belum lengkap/);assert.match(messages[0][1],/Produk, penjualan dan retur/);
 assert.equal((html.match(/id="btnSyncSheets"/g)||[]).length,1);assert.doesNotMatch(html,/id="retailSyncSheets"/);
});
test('V4 product detail connects SKU to receiving, sale, inspection and read-only ledger',()=>{
 for(const id of ['retailDetailReceive','retailDetailSell','retailDetailCheck','retailDetailHistory','retailTopScan','retailDetailCases'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(bundle,/retailInspectProduct\(retailSelectedProduct\)/);assert.match(bundle,/retailApplyProduct\(p,'intake-from-master'\)/);assert.match(bundle,/retailApplyProduct\(p,'sales'\)/);assert.match(bundle,/q=>q\.eq\('sku_produk',p\.sku\)/);assert.match(bundle,/st_stock_for_sku/);assert.doesNotMatch(html,/id="retailBalanceRows"/);
 assert.match(html,/id="btnArchiveCase"[^>]*>[\s\S]*?Hapus laporan<\/button>/);assert.match(bundle,/stocktrace_restore_record/);
});
test('V4 matching counts do not require evidence or write a case',()=>{
 const start=bundle.indexOf('async function submitReport(ev)');const f=bundle.slice(start,bundle.indexOf('const id=makeCaseId()',start));assert.ok(f.indexOf('if(sys===fis)')<f.indexOf('validateFiles(files)'));assert.match(f,/showView\('products'\);return notice\('Stok sesuai'/);assert.match(bundle,/inputKronologi'\)\.required=!match/);assert.match(bundle,/inputFile'\)\.required=!match/);
});

test('single toolbar scanner routes by visible view without duplicate local camera buttons',()=>{
 const toolbar=html.match(/<header id="appToolbar"[\s\S]*?<\/header>/)[0];assert.match(toolbar,/id="retailTopScan"/);for(const id of ['retailCaseScan','retailIntakeScan','retailSaleScan','retailInventoryScan'])assert.ok(!html.includes('id="'+id+'"'));
 const f=bundle.slice(bundle.indexOf('function retailTopScanTarget('),bundle.indexOf("retailBind('retailTopScan'"));const ctx=vm.createContext({});vm.runInContext(f,ctx);
 for(const [v,t] of [['intake','intake'],['sales','sales'],['form-laporan','case'],['products','inventory'],['dashboard','lookup'],['reports','lookup']])assert.equal(vm.runInContext('retailTopScanTarget('+JSON.stringify(v)+')',ctx),t);
 assert.match(f,/mustChangePassword/);assert.match(f,/inputSKU'\)\.readOnly/);assert.match(bundle,/if\(target==='lookup'\)[^\n]*showView\('products'\);target='inventory'/);
});
