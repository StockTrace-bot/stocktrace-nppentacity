-- StockTrace V4.3 — operator attribution and generated Word reports.
-- Additive migration: preserves existing sales, cases, evidence, and Drive records.
BEGIN;

-- Keep the salesperson separate from the authenticated operator who records the sale.
ALTER TABLE public.st_sales
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id_user);
UPDATE public.st_sales SET created_by=seller WHERE created_by IS NULL;
ALTER TABLE public.st_sales ALTER COLUMN created_by SET NOT NULL;

DROP POLICY IF EXISTS st_sales_read ON public.st_sales;
CREATE POLICY st_sales_read ON public.st_sales FOR SELECT TO authenticated
USING (
  public.stocktrace_v21_member()
  AND (seller=auth.uid() OR created_by=auth.uid() OR public.stocktrace_is_leader())
);

-- Four-argument version: p_seller is selected from the trusted Staff directory.
CREATE OR REPLACE FUNCTION public.st_record_sale(
  p_id uuid,p_receipt text,p_items jsonb,p_seller uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; p public.st_products%ROWTYPE; q integer; pr bigint; d bigint; seller_label text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN
   RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501';
 END IF;
 IF p_seller IS NULL THEN RAISE EXCEPTION 'Pilih sales yang menangani transaksi.' USING ERRCODE='22023'; END IF;
 SELECT u.nama_lengkap INTO seller_label
 FROM public.users u
 WHERE u.id_user=p_seller AND lower(btrim(u.role))='staff'
   AND length(btrim(coalesce(u.nama_lengkap,'')))>0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sales harus dipilih dari daftar Staff yang terdaftar.' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN
   RAISE EXCEPTION 'Isi 1-150 produk' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.st_sales(id,receipt,seller,seller_name,created_by)
 VALUES(p_id,btrim(p_receipt),p_seller,btrim(seller_label),auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO STRICT p FROM public.st_products WHERE id=(r->>'product_id')::uuid;
  q=(r->>'qty')::integer; pr=(r->>'unit_price')::bigint; d=(r->>'discount')::bigint;
  INSERT INTO public.st_sale_items(sale_id,product_id,sku,name,color,size,qty,unit_price,discount)
  VALUES(p_id,p.id,p.sku,p.name,p.color,p.size,q,pr,d);
 END LOOP;
 RETURN p_id;
END $$;

-- Backward-compatible entry point for older clients: the logged-in user remains the seller.
CREATE OR REPLACE FUNCTION public.st_record_sale(p_id uuid,p_receipt text,p_items jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.st_record_sale(p_id,p_receipt,p_items,auth.uid());
$$;

-- An operator who created the sale may also submit a return request for that sale.
CREATE OR REPLACE FUNCTION public.st_request_return(
 p_id uuid,p_item uuid,p_qty integer,p_condition text,p_kind text,p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.st_sales%ROWTYPE; i public.st_sale_items%ROWTYPE; taken bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT i FROM public.st_sale_items WHERE id=p_item;
 SELECT * INTO STRICT s FROM public.st_sales WHERE id=i.sale_id FOR UPDATE;
 IF s.seller<>auth.uid() AND s.created_by<>auth.uid() AND NOT public.stocktrace_is_leader() THEN
   RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501';
 END IF;
 IF s.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Transaksi sudah dibatalkan'; END IF;
 IF p_condition NOT IN ('layak','reject') OR p_kind NOT IN ('refund','exchange')
   OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 1000 THEN
   RAISE EXCEPTION 'Data retur tidak valid';
 END IF;
 SELECT coalesce(sum(qty),0) INTO taken FROM public.st_returns WHERE item_id=p_item AND status IN ('pending','approved');
 IF p_qty IS NULL OR p_qty<1 OR taken+p_qty>i.qty THEN RAISE EXCEPTION 'Jumlah retur melebihi sisa item'; END IF;
 INSERT INTO public.st_returns(id,item_id,qty,condition,kind,reason,requested_by)
 VALUES(p_id,p_item,p_qty,p_condition,p_kind,btrim(p_reason),auth.uid());
 RETURN p_id;
END $$;

REVOKE ALL ON FUNCTION public.st_record_sale(uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_record_sale(uuid,text,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.st_record_sale(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_record_sale(uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.st_request_return(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_request_return(uuid,uuid,integer,text,text,text) TO authenticated;

-- Immutable version history for generated DOCX files. Drive remains the file store.
CREATE TABLE IF NOT EXISTS public.stocktrace_report_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL REFERENCES public.cases(id_kasus) ON DELETE RESTRICT,
  version integer NOT NULL CHECK(version>=1),
  file_name text NOT NULL CHECK(length(btrim(file_name)) BETWEEN 1 AND 180),
  drive_file_id text NOT NULL UNIQUE CHECK(length(btrim(drive_file_id)) BETWEEN 10 AND 128),
  drive_view_url text NOT NULL CHECK(length(btrim(drive_view_url)) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL REFERENCES public.users(id_user),
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT st_report_case_version_unique UNIQUE(case_id,version)
);
ALTER TABLE public.stocktrace_report_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stocktrace_report_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stocktrace_report_documents TO authenticated;
DROP POLICY IF EXISTS st_report_documents_read ON public.stocktrace_report_documents;
CREATE POLICY st_report_documents_read ON public.stocktrace_report_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cases c WHERE c.id_kasus=case_id)
  );
CREATE INDEX IF NOT EXISTS st_report_documents_case_created
  ON public.stocktrace_report_documents(case_id,created_at DESC);

COMMENT ON COLUMN public.st_sales.seller IS 'Staff yang menangani penjualan.';
COMMENT ON COLUMN public.st_sales.created_by IS 'Akun operator yang mencatat transaksi.';
COMMENT ON TABLE public.stocktrace_report_documents IS 'Riwayat versi dokumen Word laporan selisih stok yang disimpan di Google Drive.';

COMMIT;
