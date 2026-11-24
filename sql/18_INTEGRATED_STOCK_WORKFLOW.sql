-- Integrate product identity and stock correction workflow. No data deletion.
BEGIN;

-- New entries must reference a registered SKU. Preserve historical names on existing rows.
CREATE OR REPLACE FUNCTION public.st_canonical_stock_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.st_products%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='cases' THEN
  SELECT * INTO p FROM public.st_products WHERE upper(sku)=upper(btrim(NEW.sku_produk));
  IF NOT FOUND THEN RAISE EXCEPTION 'Daftarkan SKU di Master Produk terlebih dahulu.' USING ERRCODE='23503'; END IF;
  NEW.sku_produk:=p.sku; NEW.nama_produk:=p.name;
 ELSE
  SELECT * INTO p FROM public.st_products WHERE upper(sku)=upper(btrim(NEW.sku));
  IF NOT FOUND THEN RAISE EXCEPTION 'Daftarkan SKU di Master Produk terlebih dahulu.' USING ERRCODE='23503'; END IF;
  NEW.sku:=p.sku; NEW.product_name:=p.name;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.st_canonical_stock_product() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS st_canonical_case_product ON public.cases;
CREATE TRIGGER st_canonical_case_product BEFORE INSERT ON public.cases FOR EACH ROW EXECUTE FUNCTION public.st_canonical_stock_product();
DROP TRIGGER IF EXISTS st_canonical_intake_product ON public.stocktrace_intake_items;
CREATE TRIGGER st_canonical_intake_product BEFORE INSERT ON public.stocktrace_intake_items FOR EACH ROW EXECUTE FUNCTION public.st_canonical_stock_product();

-- Fail safely if the existing data already has competing active corrections.
-- The unique index also prevents races between different devices.
CREATE UNIQUE INDEX IF NOT EXISTS st_one_active_correction_per_sku
 ON public.stocktrace_cashier_requests(upper(btrim(sku)))
 WHERE deleted_at IS NULL AND status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses');
CREATE UNIQUE INDEX IF NOT EXISTS st_one_active_correction_per_case
 ON public.stocktrace_cashier_requests(id_kasus)
 WHERE id_kasus IS NOT NULL AND deleted_at IS NULL AND status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses');

-- One atomic operation: reuse the matching report, or create it and its correction together.
CREATE OR REPLACE FUNCTION public.stocktrace_request_cashier_update(
 p_sku text,p_product text,p_system_qty integer,p_counted_qty integer,p_reason text,
 p_case_id text DEFAULT NULL,p_intake_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.st_products%ROWTYPE; c public.cases%ROWTYPE; cid text; iid text; rid text; matches integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Sesi tidak diizinkan' USING ERRCODE='42501'; END IF;
 IF p_system_qty IS NULL OR p_counted_qty IS NULL OR p_system_qty<0 OR p_counted_qty<0 OR p_system_qty=p_counted_qty OR
 length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Jumlah atau alasan koreksi tidak valid.' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.st_products WHERE upper(sku)=upper(btrim(p_sku)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SKU belum terdaftar di Master Produk.' USING ERRCODE='23503'; END IF;
 cid:=nullif(btrim(p_case_id),''); iid:=nullif(btrim(p_intake_id),'');
 IF iid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stocktrace_intake_items i JOIN public.stocktrace_intakes h ON h.id_intake=i.id_intake WHERE i.id_intake=iid AND upper(btrim(i.sku))=upper(p.sku) AND i.deleted_at IS NULL AND h.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'SKU tidak sesuai dengan penerimaan aktif.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.stocktrace_cashier_requests r WHERE upper(btrim(r.sku))=upper(p.sku) AND r.deleted_at IS NULL AND r.status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses')) THEN
  RAISE EXCEPTION 'SKU ini sudah memiliki koreksi aktif. Buka daftar koreksi.' USING ERRCODE='23505'; END IF;
 IF cid IS NULL THEN
  SELECT count(*),min(id_kasus) INTO matches,cid FROM public.cases WHERE upper(btrim(sku_produk))=upper(p.sku) AND deleted_at IS NULL AND status_kasus<>'Selesai' AND stok_sistem=p_system_qty AND stok_fisik=p_counted_qty;
  IF matches>1 THEN RAISE EXCEPTION 'Terdapat beberapa laporan sesuai. Pilih laporan terkait.'; END IF;
  IF matches=0 THEN
   IF EXISTS(SELECT 1 FROM public.cases WHERE upper(btrim(sku_produk))=upper(p.sku) AND deleted_at IS NULL AND status_kasus<>'Selesai') THEN
    RAISE EXCEPTION 'SKU ini memiliki laporan terbuka dengan jumlah berbeda. Periksa laporan terlebih dahulu.'; END IF;
   cid:='ST-'||to_char(now(),'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
   INSERT INTO public.cases(id_kasus,id_pelapor,sku_produk,nama_produk,stok_sistem,stok_fisik,selisih,dugaan_penyebab,kronologi,status_kasus)
    VALUES(cid,auth.uid(),p.sku,p.name,p_system_qty,p_counted_qty,p_counted_qty-p_system_qty,'Belum diketahui / perlu penelusuran',btrim(p_reason),'Baru Dilaporkan');
  END IF;
 END IF;
 SELECT * INTO c FROM public.cases WHERE id_kasus=cid AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR c.status_kasus='Selesai' OR upper(btrim(c.sku_produk))<>upper(p.sku) OR c.stok_sistem<>p_system_qty OR c.stok_fisik<>p_counted_qty THEN
  RAISE EXCEPTION 'Laporan tidak aktif atau jumlah stok tidak sesuai. Gunakan data pemeriksaan yang sama.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.stocktrace_cashier_requests WHERE id_kasus=cid AND status_request='Selesai (Dikonfirmasi)') THEN
  RAISE EXCEPTION 'Koreksi laporan ini sudah dikonfirmasi. Buat pemeriksaan baru jika terdapat selisih baru.'; END IF;
 rid:='KS-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.stocktrace_cashier_requests(id_request,sku,product_name,qty_system,qty_physical,reason,id_kasus,id_intake,created_by)
 VALUES(rid,p.sku,c.nama_produk,c.stok_sistem,c.stok_fisik,btrim(p_reason),cid,iid,auth.uid());
 INSERT INTO public.stocktrace_cashier_logs(id_request,id_user,action,note) VALUES(rid,auth.uid(),'Permintaan dibuat',btrim(p_reason));
 RETURN jsonb_build_object('ok',true,'id_request',rid,'case_id',cid);
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_request_cashier_update(text,text,integer,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_request_cashier_update(text,text,integer,integer,text,text,text) TO authenticated;

-- A correction in progress blocks closing/archiving the report. No implicit change to physical stock.
CREATE OR REPLACE FUNCTION public.st_guard_case_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ((NEW.status_kasus='Selesai' AND OLD.status_kasus IS DISTINCT FROM NEW.status_kasus) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL))
 AND EXISTS(SELECT 1 FROM public.stocktrace_cashier_requests r WHERE r.id_kasus=NEW.id_kasus AND r.deleted_at IS NULL AND r.status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses')) THEN
  RAISE EXCEPTION 'Selesaikan koreksi stok kasir terlebih dahulu.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.st_guard_case_correction() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS st_guard_case_correction ON public.cases;
CREATE TRIGGER st_guard_case_correction BEFORE UPDATE OF status_kasus,deleted_at ON public.cases FOR EACH ROW EXECUTE FUNCTION public.st_guard_case_correction();

CREATE OR REPLACE FUNCTION public.st_sync_case_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cases%ROWTYPE; action_text text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.status_request IS NOT DISTINCT FROM OLD.status_request AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
  IF NEW.status_request IS DISTINCT FROM OLD.status_request AND OLD.status_request IN ('Selesai (Dikonfirmasi)','Ditolak') THEN RAISE EXCEPTION 'Koreksi yang sudah diputus tidak dapat dibuka ulang.'; END IF;
 END IF;
 IF NEW.id_kasus IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM public.cases WHERE id_kasus=NEW.id_kasus FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.deleted_at IS NULL AND NEW.status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses') THEN
  IF c.deleted_at IS NOT NULL OR c.status_kasus='Selesai' THEN RAISE EXCEPTION 'Laporan induk tidak aktif.'; END IF;
  UPDATE public.cases SET status_kasus='Dalam Penyelesaian' WHERE id_kasus=c.id_kasus AND status_kasus IS DISTINCT FROM 'Dalam Penyelesaian';
 ELSIF c.deleted_at IS NULL AND c.status_kasus<>'Selesai' AND NEW.deleted_at IS NULL AND NEW.status_request='Selesai (Dikonfirmasi)' THEN
  UPDATE public.cases SET status_kasus='Dalam Penyelesaian' WHERE id_kasus=c.id_kasus AND status_kasus IS DISTINCT FROM 'Dalam Penyelesaian';
 ELSIF c.deleted_at IS NULL AND c.status_kasus<>'Selesai' AND (NEW.status_request='Ditolak' OR (NEW.deleted_at IS NOT NULL AND NEW.status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses'))) AND NOT EXISTS(SELECT 1 FROM public.stocktrace_cashier_requests r WHERE r.id_kasus=c.id_kasus AND r.deleted_at IS NULL AND r.status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses')) THEN
  UPDATE public.cases SET status_kasus='Dalam Pemeriksaan' WHERE id_kasus=c.id_kasus;
 END IF;
 IF auth.uid() IS NOT NULL THEN
  action_text:=CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Koreksi diarsipkan' ELSE 'Koreksi: '||NEW.status_request END;
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi) VALUES(c.id_kasus,auth.uid(),action_text,'Permintaan '||NEW.id_request,now());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.st_sync_case_correction() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS st_sync_case_correction ON public.stocktrace_cashier_requests;
CREATE TRIGGER st_sync_case_correction AFTER INSERT OR UPDATE OF status_request,deleted_at ON public.stocktrace_cashier_requests FOR EACH ROW EXECUTE FUNCTION public.st_sync_case_correction();
CREATE OR REPLACE FUNCTION public.st_stock_for_sku(p_sku text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN
  RAISE EXCEPTION 'Sesi tidak diizinkan' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('sku',p.sku,'estimated_qty',CASE WHEN o.id IS NOT NULL THEN o.qty+a.n-b.n+c.n END) INTO result
 FROM public.st_products p
 LEFT JOIN LATERAL (
  SELECT ob.* FROM public.st_opening_balances ob WHERE ob.product_id=p.id
  ORDER BY ob.opening_on DESC,ob.verified_at DESC,ob.id DESC LIMIT 1
 ) o ON true
 LEFT JOIN LATERAL (
  SELECT coalesce(sum(i.qty_accepted),0)::bigint AS n FROM public.stocktrace_intake_items i
  JOIN public.stocktrace_intakes h ON h.id_intake=i.id_intake
  WHERE upper(btrim(i.sku))=upper(p.sku) AND h.deleted_at IS NULL AND i.deleted_at IS NULL
  AND h.received_on>=o.opening_on AND h.received_on<=(now() AT TIME ZONE 'Asia/Makassar')::date
 ) a ON true
 LEFT JOIN LATERAL (
  SELECT coalesce(sum(i.qty),0)::bigint AS n FROM public.st_sale_items i
  JOIN public.st_sales h ON h.id=i.sale_id WHERE i.product_id=p.id AND h.voided_at IS NULL
  AND h.created_at>=(o.opening_on::timestamp AT TIME ZONE 'Asia/Makassar') AND h.created_at<=now()
 ) b ON true
 LEFT JOIN LATERAL (
  SELECT coalesce(sum(r.qty),0)::bigint AS n FROM public.st_returns r
  JOIN public.st_sale_items i ON i.id=r.item_id JOIN public.st_sales h ON h.id=i.sale_id
  WHERE i.product_id=p.id AND h.voided_at IS NULL AND r.status='approved' AND r.condition='layak'
  AND r.decided_at>=(o.opening_on::timestamp AT TIME ZONE 'Asia/Makassar') AND r.decided_at<=now()
 ) c ON true
 WHERE upper(p.sku)=upper(btrim(p_sku));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.st_stock_for_sku(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_stock_for_sku(text) TO authenticated;
ALTER TABLE public.stocktrace_intakes ADD COLUMN IF NOT EXISTS request_key uuid, ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS st_intake_request_key_unique ON public.stocktrace_intakes(request_key) WHERE request_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.st_create_intake_once(
 p_request_key uuid,p_document_no text,p_received_on date,p_supplier text,p_note text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_id text; v_item jsonb; v_sku text; v_product text;
 v_prior public.stocktrace_intakes%ROWTYPE; v_fingerprint text;
 v_doc integer; v_received integer; v_rejected integer; v_reason text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN
   RAISE EXCEPTION 'Sesi tidak diizinkan' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_document_no,''))) NOT BETWEEN 2 AND 100 OR
    length(btrim(coalesce(p_supplier,''))) NOT BETWEEN 2 AND 150 OR
    p_received_on IS NULL OR p_received_on > current_date+1 OR
    length(coalesce(p_note,''))>2000 THEN
   RAISE EXCEPTION 'Header penerimaan tidak valid' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN
   RAISE EXCEPTION 'Daftar SKU wajib 1–150 baris' USING ERRCODE='22023';
 END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'ID pengiriman tidak valid'; END IF;
 v_fingerprint:=md5(jsonb_build_array(p_document_no,p_received_on,p_supplier,p_note,p_items)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
 SELECT * INTO v_prior FROM public.stocktrace_intakes WHERE request_key=p_request_key;
 IF FOUND THEN
  IF v_prior.created_by<>auth.uid() OR v_prior.request_fingerprint IS DISTINCT FROM v_fingerprint OR v_prior.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Pengiriman sebelumnya berbeda atau telah diarsipkan. Periksa riwayat penerimaan.'; END IF;
  RETURN jsonb_build_object('ok',true,'id_intake',v_prior.id_intake,'count',jsonb_array_length(p_items),'replayed',true);
 END IF;
 v_id:='IN-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.stocktrace_intakes(id_intake,document_no,received_on,supplier,note,created_by,request_key,request_fingerprint)
 VALUES(v_id,btrim(p_document_no),p_received_on,btrim(p_supplier),coalesce(p_note,''),auth.uid(),p_request_key,v_fingerprint);
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_sku:=btrim(v_item->>'sku');
  v_product:=btrim(v_item->>'product_name');
  v_reason:=btrim(coalesce(v_item->>'reject_reason',''));
  IF length(coalesce(v_sku,'')) NOT BETWEEN 1 AND 80 OR length(coalesce(v_product,'')) NOT BETWEEN 2 AND 150
    OR jsonb_typeof(v_item->'qty_document') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_item->'qty_received') IS DISTINCT FROM 'number'
    OR (v_item->>'qty_document') !~ '^[0-9]{1,9}$'
    OR (v_item->>'qty_received') !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'SKU / kuantitas dokumen dan fisik tidak valid.' USING ERRCODE='22023';
  END IF;
  v_doc:=(v_item->>'qty_document')::integer;
  v_received:=(v_item->>'qty_received')::integer;
  IF NOT (v_item ? 'qty_rejected') THEN
    v_rejected:=0;
  ELSIF jsonb_typeof(v_item->'qty_rejected') IS DISTINCT FROM 'number'
     OR (v_item->>'qty_rejected') !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Jumlah reject harus bilangan bulat 0–999999999.' USING ERRCODE='22023';
  ELSE
    v_rejected:=(v_item->>'qty_rejected')::integer;
  END IF;
  IF v_rejected > v_received THEN
    RAISE EXCEPTION 'Jumlah reject SKU % melebihi jumlah fisik yang datang.',v_sku USING ERRCODE='22023';
  END IF;
  IF length(v_reason)>1000 OR (v_rejected>0 AND length(v_reason) NOT BETWEEN 3 AND 1000) THEN
    RAISE EXCEPTION 'Alasan reject SKU % wajib diisi minimal 3 dan maksimal 1000 karakter.',v_sku USING ERRCODE='22023';
  END IF;
  INSERT INTO public.stocktrace_intake_items(id_intake,sku,product_name,qty_document,qty_received,qty_rejected,reject_reason)
  VALUES(v_id,v_sku,v_product,v_doc,v_received,v_rejected,v_reason);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'id_intake',v_id,'count',jsonb_array_length(p_items));
END $$;
REVOKE ALL ON FUNCTION public.st_create_intake_once(uuid,text,date,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_create_intake_once(uuid,text,date,text,text,jsonb) TO authenticated;
COMMIT;
