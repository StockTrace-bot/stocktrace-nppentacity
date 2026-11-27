-- StockTrace V4.3.2 - additive migration; no existing rows rewritten.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.st_sales') IS NULL OR to_regclass('public.st_salespeople') IS NULL
 OR to_regprocedure('public.st_record_sale_internal(uuid,text,jsonb,uuid,boolean)') IS NULL
 OR to_regprocedure('public.stocktrace_v21_member()') IS NULL THEN
   RAISE EXCEPTION 'STOP: StockTrace V4.3.1 schema not found';
 END IF;
END $$;
ALTER TABLE public.st_sales ADD COLUMN IF NOT EXISTS pos_receipt text;
CREATE SEQUENCE IF NOT EXISTS public.st_transaction_number_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
REVOKE ALL ON SEQUENCE public.st_transaction_number_seq FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.st_sales.pos_receipt IS 'Optional original POS receipt; NULL when not provided. Legacy receipt values are unchanged.';
CREATE OR REPLACE FUNCTION public.st_record_sale_auto(
  p_id uuid,
  p_items jsonb,
  p_seller uuid,
  p_pos_receipt text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r jsonb;
  p public.st_products%ROWTYPE;
  q integer;
  pr bigint;
  d bigint;
  seller_label text;
  transaction_number text;
  serial_number text;
  pos_number text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN
    RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501';
  END IF;

  IF p_seller IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'Data sales tidak valid.' USING ERRCODE='22023';
  END IF;

  SELECT s.nama_sales INTO seller_label
  FROM public.st_salespeople s
  WHERE s.id_sales=p_seller
    AND s.is_active=true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales harus dipilih dari daftar sales aktif.' USING ERRCODE='22023';
  END IF;

  pos_number := NULLIF(btrim(COALESCE(p_pos_receipt, '')), '');
  IF length(pos_number) > 100 THEN
    RAISE EXCEPTION 'Nomor struk POS maksimal 100 karakter.' USING ERRCODE='22023';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rincian barang tidak valid.' USING ERRCODE='22023';
  END IF;

  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Isi 1–150 produk.' USING ERRCODE='22023';
  END IF;

  -- A single global sequence is concurrency-safe; numbers may have gaps.
  LOOP
    serial_number := nextval('public.st_transaction_number_seq'::regclass)::text;
    transaction_number := 'TRX-' || to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD') || '-' || lpad(serial_number, greatest(6,length(serial_number)), '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.st_sales WHERE receipt=transaction_number);
  END LOOP;
  INSERT INTO public.st_sales (id, receipt, seller, seller_name, created_by, pos_receipt)
  VALUES (p_id, transaction_number, p_seller, btrim(seller_label), auth.uid(), pos_number);

  FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO STRICT p
    FROM public.st_products
    WHERE id=(r->>'product_id')::uuid;

    q := (r->>'qty')::integer;
    pr := (r->>'unit_price')::bigint;
    d := (r->>'discount')::bigint;

    IF q IS NULL OR q NOT BETWEEN 1 AND 9999
       OR pr IS NULL OR pr NOT BETWEEN 0 AND 999999999
       OR d IS NULL OR d < 0 OR d > q::bigint * pr THEN
      RAISE EXCEPTION 'Jumlah, harga, atau diskon produk tidak valid.' USING ERRCODE='22023';
    END IF;

    INSERT INTO public.st_sale_items
      (sale_id, product_id, sku, name, color, size, qty, unit_price, discount)
    VALUES
      (p_id, p.id, p.sku, p.name, p.color, p.size, q, pr, d);
  END LOOP;

  RETURN transaction_number;
END;
$$;

REVOKE ALL ON FUNCTION public.st_record_sale_auto(uuid,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.st_record_sale_auto(uuid,jsonb,uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT jsonb_build_object('status','READY','rpc',to_regprocedure('public.st_record_sale_auto(uuid,jsonb,uuid,text)') IS NOT NULL,'pos_receipt',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='st_sales' AND column_name='pos_receipt'),'sales_preserved',(SELECT count(*) FROM public.st_sales),'salespeople_preserved',(SELECT count(*) FROM public.st_salespeople)) AS stocktrace_auto_transaction;
