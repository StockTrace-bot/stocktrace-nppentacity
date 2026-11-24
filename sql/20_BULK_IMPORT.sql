-- Additive: Leader-only, atomic imports with preview, audit and retry protection.
BEGIN;
CREATE TABLE IF NOT EXISTS public.st_import_runs (
 id uuid PRIMARY KEY, imported_by uuid NOT NULL REFERENCES public.users(id_user),
 imported_at timestamptz NOT NULL DEFAULT now(), filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('products','opening')), fingerprint text NOT NULL, result jsonb NOT NULL
);
ALTER TABLE public.st_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.st_import_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.st_import_runs TO authenticated;
DROP POLICY IF EXISTS st_import_leader_read ON public.st_import_runs;
CREATE POLICY st_import_leader_read ON public.st_import_runs FOR SELECT TO authenticated
 USING(public.stocktrace_v21_member() AND public.stocktrace_is_leader());
CREATE OR REPLACE FUNCTION public.st_bulk_import(p_id uuid,p_kind text,p_mode text,p_filename text,p_rows jsonb,p_on date,p_note text,p_preview boolean,p_expected text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; v_sku text; v_name text; v_color text; v_size text; v_price text; v_qty text; v_code text; v_codes text[];
 v_product public.st_products%ROWTYPE; v_existing public.st_import_runs%ROWTYPE; v_seen jsonb:='{}'; v_aliases jsonb:='{}';
 v_entries jsonb:='[]'; v_row integer; v_error text; v_action text; v_fingerprint text; v_snapshot text;
 v_added integer:=0; v_updated integer:=0; v_skipped integer:=0; v_invalid integer:=0; v_pid uuid; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_preview IS NULL OR p_kind IS NULL OR p_kind NOT IN ('products','opening') OR p_mode IS NULL OR p_mode NOT IN ('skip','update') OR (p_kind='opening' AND p_mode<>'skip') OR p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Permintaan impor tidak valid'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Data impor tidak valid'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 OR octet_length(p_rows::text)>1000000 THEN RAISE EXCEPTION 'Maksimal 500 baris per impor'; END IF;
 IF p_kind='opening' AND (p_on IS NULL OR p_on<DATE '2000-01-01' OR p_on>(now() AT TIME ZONE 'Asia/Makassar')::date OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 1000) THEN RAISE EXCEPTION 'Tanggal atau catatan stok awal tidak valid'; END IF;
 v_fingerprint:=md5(jsonb_build_array(p_kind,p_mode,p_filename,p_rows,p_on,p_note)::text);
 -- Serialize all catalog writers during commit; preview never writes or locks tables.
 IF NOT p_preview THEN
  LOCK TABLE public.st_products,public.st_product_codes,public.st_opening_balances IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v_existing FROM public.st_import_runs WHERE id=p_id;
  IF FOUND THEN
   IF v_existing.imported_by<>auth.uid() OR v_existing.fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'ID impor telah digunakan'; END IF;
   RETURN v_existing.result;
  END IF;
 END IF;
 -- First pass reserves SKU namespace for all rows, including duplicates.
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Baris impor tidak valid'; END IF;
  v_sku:=upper(btrim(coalesce(r->>'sku','')));
  v_seen:=jsonb_set(v_seen,ARRAY[v_sku],to_jsonb(coalesce((v_seen->>v_sku)::integer,0)+1),true);
 END LOOP;
 FOR r,v_row IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
  v_error:=''; v_action:='baru';
  v_sku:=upper(btrim(coalesce(r->>'sku',''))); v_name:=btrim(coalesce(r->>'name','')); v_color:=btrim(coalesce(r->>'color','')); v_size:=btrim(coalesce(r->>'size','')); v_price:=btrim(coalesce(r->>'price','')); v_qty:=btrim(coalesce(r->>'qty',''));
  SELECT * INTO v_product FROM public.st_products WHERE upper(sku)=v_sku;
  IF jsonb_typeof(r->'sku') IS DISTINCT FROM 'string' OR length(v_sku) NOT BETWEEN 1 AND 80 THEN v_error:='SKU tidak valid';
  ELSIF (v_seen->>v_sku)::integer>1 THEN v_error:='SKU berulang dalam file';
  ELSIF p_kind='opening' THEN
   IF v_product.id IS NULL THEN v_error:='SKU belum terdaftar';
   ELSIF v_qty !~ '^[0-9]{1,9}$' THEN v_error:='Stok awal harus bilangan bulat 0–999999999';
   ELSIF EXISTS(SELECT 1 FROM public.st_opening_balances b WHERE b.product_id=v_product.id) THEN v_action:='lewati'; END IF;
  ELSE
   IF v_product.id IS NOT NULL AND p_mode='skip' THEN v_action:='lewati';
   ELSE
    IF v_product.id IS NOT NULL THEN v_action:='perbarui'; END IF;
    IF (r ? 'barcode' AND jsonb_typeof(r->'barcode') IS DISTINCT FROM 'string') OR (r ? 'qr' AND jsonb_typeof(r->'qr') IS DISTINCT FROM 'string') THEN v_error:='Barcode dan QR harus berupa teks'; END IF;
    IF (v_product.id IS NULL AND length(v_name)<2) OR (v_name<>'' AND length(v_name) NOT BETWEEN 2 AND 150) OR length(v_color)>80 OR length(v_size)>80 THEN v_error:='Nama, warna atau ukuran tidak valid';
    ELSIF (v_product.id IS NULL OR v_price<>'') AND v_price !~ '^[0-9]{1,9}$' THEN v_error:='Harga wajib untuk SKU baru; gunakan rupiah bulat tanpa pemisah'; END IF;
    IF EXISTS(SELECT 1 FROM public.st_product_codes c WHERE upper(c.code)=v_sku AND c.product_id IS DISTINCT FROM v_product.id) THEN v_error:='SKU bertabrakan dengan kode produk lain'; END IF;
    v_codes:=ARRAY(SELECT DISTINCT btrim(x) FROM unnest(ARRAY[coalesce(r->>'barcode',''),coalesce(r->>'qr','')]) x WHERE btrim(x)<>'');
    FOREACH v_code IN ARRAY v_codes LOOP
     IF length(v_code)>512 THEN v_error:='Kode terlalu panjang';
     ELSIF EXISTS(SELECT 1 FROM public.st_product_codes c WHERE c.code=v_code AND c.product_id IS DISTINCT FROM v_product.id) THEN v_error:='Kode milik produk lain';
     ELSIF EXISTS(SELECT 1 FROM public.st_products p WHERE upper(p.sku)=upper(v_code) AND p.id IS DISTINCT FROM v_product.id) OR (v_seen ? upper(v_code) AND upper(v_code)<>v_sku) THEN v_error:='Kode bertabrakan dengan SKU lain';
     ELSIF v_aliases ? v_code AND v_aliases->>v_code<>v_sku THEN v_error:='Kode berulang antar SKU dalam file';
     ELSE v_aliases:=jsonb_set(v_aliases,ARRAY[v_code],to_jsonb(v_sku),true); END IF;
    END LOOP;
   END IF;
  END IF;
  IF v_error<>'' THEN v_action:='gagal'; v_invalid:=v_invalid+1;
  ELSIF v_action='baru' THEN v_added:=v_added+1;
  ELSIF v_action='perbarui' THEN v_updated:=v_updated+1;
  ELSE v_skipped:=v_skipped+1; END IF;
  v_entries:=v_entries||jsonb_build_array(jsonb_build_object('row',v_row,'sku',v_sku,'action',v_action,'error',v_error,'version',v_product.updated_at,'product_id',v_product.id));
 END LOOP;
 v_snapshot:=md5(jsonb_build_array(v_fingerprint,v_entries)::text);
 v_result:=jsonb_build_object('rows',v_entries,'added',v_added,'updated',v_updated,'skipped',v_skipped,'invalid',v_invalid,'snapshot',v_snapshot);
 IF p_preview THEN RETURN v_result; END IF;
 IF v_invalid>0 OR p_expected IS DISTINCT FROM v_snapshot THEN RAISE EXCEPTION 'Data berubah atau tidak valid. Jalankan validasi ulang'; END IF;
 IF v_added+v_updated=0 THEN RAISE EXCEPTION 'Tidak ada perubahan untuk disimpan'; END IF;
 FOR r,v_row IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
  v_action:=v_entries->(v_row-1)->>'action'; IF v_action='lewati' THEN CONTINUE; END IF;
  v_sku:=upper(btrim(r->>'sku'));
  IF p_kind='opening' THEN
   PERFORM public.st_verify_opening(v_sku,p_on,(r->>'qty')::bigint,p_note);
  ELSE
   v_name:=btrim(coalesce(r->>'name','')); v_color:=btrim(coalesce(r->>'color','')); v_size:=btrim(coalesce(r->>'size','')); v_price:=btrim(coalesce(r->>'price',''));
   IF v_action='baru' THEN
    INSERT INTO public.st_products(sku,name,color,size,price,created_by) VALUES(v_sku,v_name,v_color,v_size,v_price::bigint,auth.uid()) RETURNING id INTO v_pid;
   ELSE
    UPDATE public.st_products SET name=coalesce(nullif(v_name,''),name),color=coalesce(nullif(v_color,''),color),size=coalesce(nullif(v_size,''),size),price=coalesce(nullif(v_price,'')::bigint,price),updated_by=auth.uid(),updated_at=now() WHERE upper(sku)=v_sku RETURNING id INTO v_pid;
   END IF;
   FOR v_code IN SELECT DISTINCT btrim(x) FROM unnest(ARRAY[coalesce(r->>'barcode',''),coalesce(r->>'qr','')]) x WHERE btrim(x)<>'' LOOP
    INSERT INTO public.st_product_codes(code,product_id,created_by) VALUES(v_code,v_pid,auth.uid()) ON CONFLICT(code) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.st_product_codes WHERE code=v_code AND product_id=v_pid) THEN RAISE EXCEPTION 'Kode milik produk lain'; END IF;
   END LOOP;
  END IF;
 END LOOP;
 INSERT INTO public.st_import_runs(id,imported_by,filename,kind,fingerprint,result) VALUES(p_id,auth.uid(),p_filename,p_kind,v_fingerprint,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.st_bulk_import(uuid,text,text,text,jsonb,date,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.st_bulk_import(uuid,text,text,text,jsonb,date,text,boolean,text) TO authenticated;
COMMIT;
