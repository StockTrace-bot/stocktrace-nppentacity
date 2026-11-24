-- Additive migration. Run on staging first; existing records and webhooks are untouched.
BEGIN;
CREATE TABLE public.st_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL CHECK(length(btrim(sku)) BETWEEN 1 AND 80),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150), color text NOT NULL DEFAULT '' CHECK(length(color)<=80),
 size text NOT NULL DEFAULT '' CHECK(length(size)<=80), price bigint NOT NULL CHECK(price BETWEEN 0 AND 999999999),
 created_by uuid NOT NULL REFERENCES public.users(id_user), created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.users(id_user), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX st_product_sku_unique ON public.st_products (upper(sku));
CREATE TABLE public.st_product_codes (
 code text PRIMARY KEY CHECK(length(btrim(code)) BETWEEN 1 AND 512), product_id uuid NOT NULL REFERENCES public.st_products(id),
 created_by uuid NOT NULL REFERENCES public.users(id_user), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.st_sales (
 id uuid PRIMARY KEY, receipt text NOT NULL CHECK(length(btrim(receipt)) BETWEEN 1 AND 100),
 seller uuid NOT NULL REFERENCES public.users(id_user), seller_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, voided_by uuid REFERENCES public.users(id_user), void_reason text,
 CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(void_reason)>=8))
);
CREATE UNIQUE INDEX st_sales_receipt_unique ON public.st_sales (lower(receipt)) WHERE voided_at IS NULL;
CREATE INDEX st_sales_date ON public.st_sales (created_at,seller);
CREATE TABLE public.st_sale_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES public.st_sales(id),
 product_id uuid NOT NULL REFERENCES public.st_products(id), sku text NOT NULL, name text NOT NULL, color text NOT NULL, size text NOT NULL,
 qty integer NOT NULL CHECK(qty BETWEEN 1 AND 9999), unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 999999999),
 discount bigint NOT NULL CHECK(discount>=0 AND discount<=qty*unit_price), UNIQUE(sale_id,product_id)
);
CREATE TABLE public.st_returns (
 id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES public.st_sale_items(id), qty integer NOT NULL CHECK(qty BETWEEN 1 AND 9999),
 condition text NOT NULL CHECK(condition IN ('layak','reject')), kind text NOT NULL CHECK(kind IN ('refund','exchange')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 1000), requested_by uuid NOT NULL REFERENCES public.users(id_user),
 created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decided_by uuid REFERENCES public.users(id_user), decided_at timestamptz, decision_note text, refund bigint NOT NULL DEFAULT 0 CHECK(refund>=0)
);
CREATE INDEX st_returns_item ON public.st_returns(item_id,status);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['st_products','st_product_codes','st_sales','st_sale_items','st_returns'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY st_products_read ON public.st_products FOR SELECT TO authenticated USING(public.stocktrace_v21_member());
CREATE POLICY st_codes_read ON public.st_product_codes FOR SELECT TO authenticated USING(public.stocktrace_v21_member());
CREATE POLICY st_sales_read ON public.st_sales FOR SELECT TO authenticated USING(public.stocktrace_v21_member() AND (seller=auth.uid() OR public.stocktrace_is_leader()));
CREATE POLICY st_items_read ON public.st_sale_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.st_sales s WHERE s.id=sale_id));
CREATE POLICY st_returns_read ON public.st_returns FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.st_sale_items i WHERE i.id=item_id));

CREATE FUNCTION public.st_register_product(p_sku text,p_name text,p_color text,p_size text,p_price bigint,p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 INSERT INTO public.st_products(sku,name,color,size,price,created_by) VALUES(upper(btrim(p_sku)),btrim(p_name),btrim(coalesce(p_color,'')),btrim(coalesce(p_size,'')),p_price,auth.uid()) RETURNING id INTO pid;
 IF length(btrim(coalesce(p_code,'')))>0 THEN INSERT INTO public.st_product_codes(code,product_id,created_by) VALUES(btrim(p_code),pid,auth.uid()); END IF;
 RETURN pid;
END $$;
CREATE FUNCTION public.st_update_product(p_id uuid,p_name text,p_color text,p_size text,p_price bigint,p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501'; END IF;
 UPDATE public.st_products SET name=btrim(p_name),color=btrim(coalesce(p_color,'')),size=btrim(coalesce(p_size,'')),price=p_price,updated_by=auth.uid(),updated_at=now() WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;
 IF length(btrim(coalesce(p_code,'')))>0 THEN
  INSERT INTO public.st_product_codes(code,product_id,created_by) VALUES(btrim(p_code),p_id,auth.uid()) ON CONFLICT(code) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.st_product_codes WHERE code=btrim(p_code) AND product_id=p_id) THEN RAISE EXCEPTION 'Kode milik produk lain'; END IF;
 END IF;
END $$;
CREATE FUNCTION public.st_record_sale(p_id uuid,p_receipt text,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; p public.st_products%ROWTYPE; q integer; pr bigint; d bigint; seller_label text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Rincian barang tidak valid'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Isi 1-150 produk'; END IF;
 SELECT nama_lengkap INTO seller_label FROM public.users WHERE id_user=auth.uid();
 INSERT INTO public.st_sales(id,receipt,seller,seller_name) VALUES(p_id,btrim(p_receipt),auth.uid(),coalesce(seller_label,'Pengguna'));
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO STRICT p FROM public.st_products WHERE id=(r->>'product_id')::uuid;
  q=(r->>'qty')::integer; pr=(r->>'unit_price')::bigint; d=(r->>'discount')::bigint;
  INSERT INTO public.st_sale_items(sale_id,product_id,sku,name,color,size,qty,unit_price,discount) VALUES(p_id,p.id,p.sku,p.name,p.color,p.size,q,pr,d);
 END LOOP;
 RETURN p_id;
END $$;
CREATE FUNCTION public.st_request_return(p_id uuid,p_item uuid,p_qty integer,p_condition text,p_kind text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.st_sales%ROWTYPE; i public.st_sale_items%ROWTYPE; taken bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT i FROM public.st_sale_items WHERE id=p_item;
 SELECT * INTO STRICT s FROM public.st_sales WHERE id=i.sale_id FOR UPDATE;
 IF s.seller<>auth.uid() AND NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 IF s.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Transaksi sudah dibatalkan'; END IF;
 SELECT coalesce(sum(qty),0) INTO taken FROM public.st_returns WHERE item_id=p_item AND status IN ('pending','approved');
 IF p_qty IS NULL OR p_qty<1 OR taken+p_qty>i.qty THEN RAISE EXCEPTION 'Jumlah retur melebihi sisa item'; END IF;
 INSERT INTO public.st_returns(id,item_id,qty,condition,kind,reason,requested_by) VALUES(p_id,p_item,p_qty,p_condition,p_kind,btrim(p_reason),auth.uid());
 RETURN p_id;
END $$;
CREATE FUNCTION public.st_decide_return(p_id uuid,p_approve boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.st_returns%ROWTYPE; i public.st_sale_items%ROWTYPE; s public.st_sales%ROWTYPE; already_qty bigint; net bigint; amount bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501'; END IF;
 IF p_approve IS NULL OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 1000 THEN RAISE EXCEPTION 'Catatan keputusan wajib 8-1000 karakter'; END IF;
 SELECT * INTO STRICT r FROM public.st_returns WHERE id=p_id;
 SELECT * INTO STRICT i FROM public.st_sale_items WHERE id=r.item_id;
 SELECT * INTO STRICT s FROM public.st_sales WHERE id=i.sale_id FOR UPDATE;
 SELECT * INTO STRICT r FROM public.st_returns WHERE id=p_id FOR UPDATE;
 IF r.status<>'pending' OR s.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Retur tidak dapat diproses'; END IF;
 SELECT coalesce(sum(qty),0) INTO already_qty FROM public.st_returns WHERE item_id=i.id AND status='approved';
 IF p_approve AND already_qty+r.qty>i.qty THEN RAISE EXCEPTION 'Jumlah retur melampaui penjualan'; END IF;
 net=i.qty*i.unit_price-i.discount;
 amount=CASE WHEN p_approve THEN ((already_qty+r.qty)*net/i.qty)-(already_qty*net/i.qty) ELSE 0 END;
 UPDATE public.st_returns SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_at=now(),decided_by=auth.uid(),decision_note=btrim(p_note),refund=amount WHERE id=p_id;
END $$;
CREATE FUNCTION public.st_void_sale(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.st_sales%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 1000 THEN RAISE EXCEPTION 'Alasan wajib 8-1000 karakter'; END IF;
 SELECT * INTO STRICT s FROM public.st_sales WHERE id=p_id FOR UPDATE;
 IF s.voided_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.st_returns r JOIN public.st_sale_items i ON i.id=r.item_id WHERE i.sale_id=p_id AND r.status IN ('pending','approved')) THEN RAISE EXCEPTION 'Transaksi dibatalkan atau memiliki retur aktif'; END IF;
 UPDATE public.st_sales SET voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) WHERE id=p_id;
END $$;
CREATE FUNCTION public.st_monthly_movements(p_month date)
RETURNS TABLE(sku text, name text, received bigint, intake_reject bigint, sold bigint, returned_good bigint, returned_reject bigint, movement bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d1 timestamptz; d2 timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN RAISE EXCEPTION 'Hanya Leader' USING ERRCODE='42501'; END IF;
 IF p_month IS NULL OR extract(day from p_month)<>1 THEN RAISE EXCEPTION 'Bulan tidak valid'; END IF;
 d1=p_month::timestamp AT TIME ZONE 'Asia/Makassar'; d2=(p_month+interval '1 month') AT TIME ZONE 'Asia/Makassar';
 RETURN QUERY WITH changes AS (
 SELECT upper(btrim(i.sku)) AS code,i.product_name AS label,i.qty_accepted::bigint AS incoming,i.qty_rejected::bigint AS rejected,0::bigint AS outgoing,0::bigint AS good,0::bigint AS damaged
 FROM public.stocktrace_intake_items i JOIN public.stocktrace_intakes h ON h.id_intake=i.id_intake
 WHERE h.deleted_at IS NULL AND i.deleted_at IS NULL AND h.received_on>=p_month AND h.received_on<(p_month+interval '1 month')::date
 UNION ALL SELECT upper(i.sku),i.name,0,0,i.qty,0,0 FROM public.st_sale_items i JOIN public.st_sales h ON h.id=i.sale_id WHERE h.voided_at IS NULL AND h.created_at>=d1 AND h.created_at<d2
 UNION ALL SELECT upper(i.sku),i.name,0,0,0,CASE WHEN r.condition='layak' THEN r.qty ELSE 0 END,CASE WHEN r.condition='reject' THEN r.qty ELSE 0 END FROM public.st_returns r JOIN public.st_sale_items i ON i.id=r.item_id JOIN public.st_sales h ON h.id=i.sale_id WHERE h.voided_at IS NULL AND r.status='approved' AND r.decided_at>=d1 AND r.decided_at<d2
 ), sums AS (SELECT c.code,max(c.label) AS label,sum(c.incoming)::bigint AS incoming,sum(c.rejected)::bigint AS rejected,sum(c.outgoing)::bigint AS outgoing,sum(c.good)::bigint AS good,sum(c.damaged)::bigint AS damaged FROM changes c GROUP BY c.code)
 SELECT a.code,coalesce(p.name,a.label),a.incoming,a.rejected,a.outgoing,a.good,a.damaged,a.incoming-a.outgoing+a.good FROM sums a LEFT JOIN public.st_products p ON upper(p.sku)=a.code ORDER BY a.code;
END $$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['st_register_product(text,text,text,text,bigint,text)','st_update_product(uuid,text,text,text,bigint,text)','st_record_sale(uuid,text,jsonb)','st_request_return(uuid,uuid,integer,text,text,text)','st_decide_return(uuid,boolean,text)','st_void_sale(uuid,text)','st_monthly_movements(date)'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO authenticated';
 END LOOP;
END $$;
COMMIT;
