-- Verified opening snapshots, separate from the official cashier system.
BEGIN;
CREATE TABLE public.st_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES public.st_products(id),
 opening_on date NOT NULL,
 qty bigint NOT NULL CHECK(qty BETWEEN 0 AND 999999999),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 8 AND 1000),
 verified_by uuid NOT NULL REFERENCES public.users(id_user),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX st_opening_lookup ON public.st_opening_balances(product_id,opening_on DESC,verified_at DESC,id);
ALTER TABLE public.st_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.st_opening_balances FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.st_opening_balances TO authenticated;
CREATE POLICY st_opening_leader ON public.st_opening_balances FOR SELECT TO authenticated
 USING(public.stocktrace_v21_member() AND public.stocktrace_is_leader());

CREATE FUNCTION public.st_verify_opening(p_sku text,p_on date,p_qty bigint,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; result uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN
  RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501';
 END IF;
 IF p_on IS NULL OR p_on>(now() AT TIME ZONE 'Asia/Makassar')::date OR p_on<DATE '2000-01-01' THEN RAISE EXCEPTION 'Tanggal saldo awal tidak valid'; END IF;
 SELECT id INTO STRICT pid FROM public.st_products WHERE upper(sku)=upper(btrim(p_sku));
 INSERT INTO public.st_opening_balances(product_id,opening_on,qty,note,verified_by)
 VALUES(pid,p_on,p_qty,btrim(p_note),auth.uid()) RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.st_estimated_balances()
RETURNS TABLE(sku text,name text,opening_on date,opening_qty bigint,received bigint,sold bigint,returned_good bigint,estimated_qty bigint,verified_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN
  RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT p.sku,p.name,o.opening_on,o.qty,
 CASE WHEN o.id IS NOT NULL THEN a.n END,
 CASE WHEN o.id IS NOT NULL THEN b.n END,
 CASE WHEN o.id IS NOT NULL THEN c.n END,
 CASE WHEN o.id IS NOT NULL THEN o.qty+a.n-b.n+c.n END,o.verified_at
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
 ORDER BY p.sku;
END $$;
REVOKE ALL ON FUNCTION public.st_verify_opening(text,date,bigint,text),public.st_estimated_balances() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.st_verify_opening(text,date,bigint,text),public.st_estimated_balances() TO authenticated;
COMMIT;
