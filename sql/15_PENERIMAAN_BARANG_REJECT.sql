-- StockTrace V2.4 — pencatatan barang reject pada penerimaan dari pusat.
-- Jalankan SATU KALI di Supabase Production setelah backup dan sebelum deploy source V2.4.
-- Additive only: data lama tetap ada; semua penerimaan lama otomatis memiliki qty_rejected = 0.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.stocktrace_intake_items') IS NULL
     OR to_regclass('public.stocktrace_intake_evidence') IS NULL
     OR to_regprocedure('public.stocktrace_create_intake(text,date,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.stocktrace_v21_member()') IS NULL THEN
    RAISE EXCEPTION 'Preflight gagal: pastikan modul penerimaan V2.1 dan fungsi akses aktif.';
  END IF;
END
$preflight$;

ALTER TABLE public.stocktrace_intake_items
  ADD COLUMN IF NOT EXISTS qty_rejected integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reject_reason text NOT NULL DEFAULT '';

ALTER TABLE public.stocktrace_intake_items
  ADD COLUMN IF NOT EXISTS qty_accepted integer GENERATED ALWAYS AS (qty_received - qty_rejected) STORED,
  ADD COLUMN IF NOT EXISTS qty_accepted_difference integer GENERATED ALWAYS AS ((qty_received - qty_rejected) - qty_document) STORED;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='st_intake_reject_qty_valid' AND conrelid='public.stocktrace_intake_items'::regclass) THEN
    ALTER TABLE public.stocktrace_intake_items ADD CONSTRAINT st_intake_reject_qty_valid
      CHECK (qty_rejected >= 0 AND qty_rejected <= qty_received);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='st_intake_reject_reason_valid' AND conrelid='public.stocktrace_intake_items'::regclass) THEN
    ALTER TABLE public.stocktrace_intake_items ADD CONSTRAINT st_intake_reject_reason_valid
      CHECK (length(reject_reason) <= 1000 AND (qty_rejected = 0 OR length(btrim(reject_reason)) BETWEEN 3 AND 1000));
  END IF;
END
$constraints$;

ALTER TABLE public.stocktrace_intake_evidence
  ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'Bukti Penerimaan';

DO $evidence_constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='st_intake_evidence_type_valid' AND conrelid='public.stocktrace_intake_evidence'::regclass) THEN
    ALTER TABLE public.stocktrace_intake_evidence ADD CONSTRAINT st_intake_evidence_type_valid
      CHECK (evidence_type IN ('Bukti Penerimaan','Bukti Barang Reject'));
  END IF;
END
$evidence_constraint$;

-- Permit only the new, validated evidence classification field on browser metadata inserts.
GRANT INSERT (id_intake,nama_file_asli,drive_file_id,drive_view_url,evidence_type)
  ON public.stocktrace_intake_evidence TO authenticated;

-- Backward compatible RPC: older clients that omit qty_rejected/reject_reason still save zero reject.
CREATE OR REPLACE FUNCTION public.stocktrace_create_intake(
 p_document_no text,p_received_on date,p_supplier text,p_note text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_id text; v_item jsonb; v_sku text; v_product text;
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
 v_id:='IN-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.stocktrace_intakes(id_intake,document_no,received_on,supplier,note,created_by)
 VALUES(v_id,btrim(p_document_no),p_received_on,btrim(p_supplier),coalesce(p_note,''),auth.uid());
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
REVOKE ALL ON FUNCTION public.stocktrace_create_intake(text,date,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_create_intake(text,date,text,text,jsonb) TO authenticated;

COMMIT;

-- QA non-destruktif:
-- SELECT column_name,data_type,is_generated,column_default FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='stocktrace_intake_items'
-- AND column_name IN ('qty_rejected','qty_accepted','qty_accepted_difference','reject_reason');
-- SELECT evidence_type,count(*) FROM public.stocktrace_intake_evidence GROUP BY evidence_type;
