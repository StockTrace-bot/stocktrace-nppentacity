-- StockTrace V2.1 — Penerimaan barang, selisih per SKU, dan permintaan update stok kasir.
-- HANYA setelah SQL 05,08,09 aktif di lingkungan STAGING dan backup telah dibuat.
-- Non-destruktif: tidak mengubah cases/evidence_files/case_logs atau data stok resmi.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.users') IS NULL OR to_regprocedure('public.stocktrace_can_use_app()') IS NULL
 THEN RAISE EXCEPTION 'Instalasi V2 (users + stocktrace_can_use_app) belum siap'; END IF;
END $$;

-- Helper peran aktif; gunakan di RLS maupun RPC agar akun non-operasional tidak masuk.
CREATE OR REPLACE FUNCTION public.stocktrace_v21_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT public.stocktrace_can_use_app() AND EXISTS(
 SELECT 1 FROM public.users u WHERE u.id_user=auth.uid()
 AND lower(btrim(u.role)) IN ('staff','leader','admin','store leader','store_leader')
); $$;
REVOKE ALL ON FUNCTION public.stocktrace_v21_member() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_v21_member() TO authenticated;

CREATE TABLE IF NOT EXISTS public.stocktrace_intakes (
 id_intake text PRIMARY KEY,
 document_no text NOT NULL CHECK(length(btrim(document_no)) BETWEEN 2 AND 100),
 received_on date NOT NULL,
 supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 2 AND 150),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 created_by uuid NOT NULL REFERENCES public.users(id_user),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.stocktrace_intake_items (
 id_item uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 id_intake text NOT NULL REFERENCES public.stocktrace_intakes(id_intake) ON DELETE RESTRICT,
 sku text NOT NULL CHECK(length(btrim(sku)) BETWEEN 1 AND 80),
 product_name text NOT NULL CHECK(length(btrim(product_name)) BETWEEN 2 AND 150),
 qty_document integer NOT NULL CHECK(qty_document >= 0),
 qty_received integer NOT NULL CHECK(qty_received >= 0),
 qty_difference integer GENERATED ALWAYS AS (qty_received - qty_document) STORED,
 UNIQUE(id_intake,sku)
);
CREATE INDEX IF NOT EXISTS st_intake_received_idx ON public.stocktrace_intakes(received_on DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS st_intake_items_sku_idx ON public.stocktrace_intake_items(sku);
CREATE UNIQUE INDEX IF NOT EXISTS st_intake_unique_sku_nocase ON public.stocktrace_intake_items(id_intake,upper(sku));
CREATE TABLE IF NOT EXISTS public.stocktrace_intake_evidence (
 id_file uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 id_intake text NOT NULL REFERENCES public.stocktrace_intakes(id_intake) ON DELETE RESTRICT,
 nama_file_asli text NOT NULL CHECK(length(btrim(nama_file_asli)) BETWEEN 1 AND 120),
 drive_file_id text NOT NULL UNIQUE CHECK(length(drive_file_id) BETWEEN 10 AND 128),
 drive_view_url text,
 uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id_user),
 waktu_unggah timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS st_intake_evidence_idx ON public.stocktrace_intake_evidence(id_intake);

CREATE TABLE IF NOT EXISTS public.stocktrace_cashier_requests (
 id_request text PRIMARY KEY,
 sku text NOT NULL CHECK(length(btrim(sku)) BETWEEN 1 AND 80),
 product_name text NOT NULL CHECK(length(btrim(product_name)) BETWEEN 2 AND 150),
 qty_system integer NOT NULL CHECK(qty_system>=0),
 qty_physical integer NOT NULL CHECK(qty_physical>=0),
 qty_difference integer GENERATED ALWAYS AS (qty_physical - qty_system) STORED,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
 id_kasus text REFERENCES public.cases(id_kasus) ON DELETE SET NULL,
 id_intake text REFERENCES public.stocktrace_intakes(id_intake) ON DELETE SET NULL,
 status_request text NOT NULL DEFAULT 'Diajukan' CHECK(status_request IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses','Selesai (Dikonfirmasi)','Ditolak')),
 created_by uuid NOT NULL REFERENCES public.users(id_user),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.users(id_user)
);
CREATE TABLE IF NOT EXISTS public.stocktrace_cashier_logs (
 id_log uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 id_request text NOT NULL REFERENCES public.stocktrace_cashier_requests(id_request) ON DELETE RESTRICT,
 id_user uuid NOT NULL REFERENCES public.users(id_user),
 action text NOT NULL,
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS st_cashier_requests_status_idx ON public.stocktrace_cashier_requests(status_request,created_at DESC);
CREATE INDEX IF NOT EXISTS st_cashier_logs_request_idx ON public.stocktrace_cashier_logs(id_request,created_at DESC);

-- Semua tabel baru hanya dapat dibaca oleh akun internal terautentikasi dan siap password.
-- Tidak memberi UPDATE/DELETE/INSERT langsung ke aplikasi, kecuali metadata bukti yang diverifikasi server.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stocktrace_intakes','stocktrace_intake_items','stocktrace_intake_evidence','stocktrace_cashier_requests','stocktrace_cashier_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS st_v21_read ON public.%I',t);
  EXECUTE format('CREATE POLICY st_v21_read ON public.%I FOR SELECT TO authenticated USING (public.stocktrace_v21_member())',t);
 END LOOP;
END $$;
-- Browser hanya boleh merekam metadata bukti miliknya; otorisasi terhadap intake dilakukan server upload.
GRANT INSERT(id_intake,nama_file_asli,drive_file_id,drive_view_url) ON public.stocktrace_intake_evidence TO authenticated;
CREATE POLICY st_v21_evidence_insert ON public.stocktrace_intake_evidence FOR INSERT TO authenticated
WITH CHECK(public.stocktrace_v21_member() AND uploaded_by=auth.uid() AND
 EXISTS (SELECT 1 FROM public.stocktrace_intakes i WHERE i.id_intake=stocktrace_intake_evidence.id_intake));

CREATE OR REPLACE FUNCTION public.stocktrace_create_intake(
 p_document_no text,p_received_on date,p_supplier text,p_note text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_id text; v_item jsonb; v_sku text; v_product text; v_doc integer; v_received integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Sesi tidak diizinkan' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_document_no,''))) NOT BETWEEN 2 AND 100 OR
    length(btrim(coalesce(p_supplier,''))) NOT BETWEEN 2 AND 150 OR
    p_received_on IS NULL OR p_received_on > current_date+1 OR
    length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Header penerimaan tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN
  RAISE EXCEPTION 'Daftar SKU wajib 1–150 baris' USING ERRCODE='22023'; END IF;
 v_id:='IN-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.stocktrace_intakes(id_intake,document_no,received_on,supplier,note,created_by)
 VALUES(v_id,btrim(p_document_no),p_received_on,btrim(p_supplier),coalesce(p_note,''),auth.uid());
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_sku:=btrim(v_item->>'sku'); v_product:=btrim(v_item->>'product_name');
  IF length(coalesce(v_sku,'')) NOT BETWEEN 1 AND 80 OR length(coalesce(v_product,'')) NOT BETWEEN 2 AND 150
    OR jsonb_typeof(v_item->'qty_document') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_item->'qty_received') IS DISTINCT FROM 'number'
    OR (v_item->>'qty_document') !~ '^[0-9]{1,9}$'
    OR (v_item->>'qty_received') !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'SKU / kuantitas tidak valid. Gunakan bilangan bulat 0–999999999.' USING ERRCODE='22023'; END IF;
  v_doc:=(v_item->>'qty_document')::integer;v_received:=(v_item->>'qty_received')::integer;
  INSERT INTO public.stocktrace_intake_items(id_intake,sku,product_name,qty_document,qty_received)
  VALUES(v_id,v_sku,v_product,v_doc,v_received);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'id_intake',v_id,'count',jsonb_array_length(p_items));
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_create_intake(text,date,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_create_intake(text,date,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.stocktrace_request_cashier_update(
 p_sku text,p_product text,p_system_qty integer,p_counted_qty integer,p_reason text,
 p_case_id text DEFAULT NULL,p_intake_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_id text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() THEN RAISE EXCEPTION 'Sesi tidak diizinkan' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_sku,''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_product,''))) NOT BETWEEN 2 AND 150 OR
 p_system_qty IS NULL OR p_counted_qty IS NULL OR p_system_qty<0 OR p_counted_qty<0 OR p_system_qty=p_counted_qty OR
 length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN
 RAISE EXCEPTION 'Rincian permintaan kasir tidak valid atau tidak ada selisih.' USING ERRCODE='22023'; END IF;
 IF p_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=p_case_id)
 THEN RAISE EXCEPTION 'Kasus R1 tidak ditemukan atau tidak berhak diakses' USING ERRCODE='42501'; END IF;
 IF p_intake_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stocktrace_intakes i WHERE i.id_intake=p_intake_id)
 THEN RAISE EXCEPTION 'Dokumen penerimaan tidak ditemukan' USING ERRCODE='22023'; END IF;
 v_id:='KS-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.stocktrace_cashier_requests(id_request,sku,product_name,qty_system,qty_physical,reason,id_kasus,id_intake,created_by)
 VALUES(v_id,btrim(p_sku),btrim(p_product),p_system_qty,p_counted_qty,btrim(p_reason),NULLIF(p_case_id,''),NULLIF(p_intake_id,''),auth.uid());
 INSERT INTO public.stocktrace_cashier_logs(id_request,id_user,action,note)
 VALUES(v_id,auth.uid(),'Permintaan dibuat',btrim(p_reason));
 RETURN jsonb_build_object('ok',true,'id_request',v_id);
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_request_cashier_update(text,text,integer,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_request_cashier_update(text,text,integer,integer,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.stocktrace_update_cashier_status(p_request_id text,p_status text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN
 RAISE EXCEPTION 'Hanya Leader/Admin' USING ERRCODE='42501';END IF;
 IF p_status NOT IN ('Diajukan','Diteruskan ke Kasir','Sedang Diproses','Selesai (Dikonfirmasi)','Ditolak') OR
 length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Status/catatan tidak valid' USING ERRCODE='22023';END IF;
 SELECT status_request INTO v_old FROM public.stocktrace_cashier_requests WHERE id_request=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Permintaan tidak ditemukan' USING ERRCODE='P0002';END IF;
 UPDATE public.stocktrace_cashier_requests SET status_request=p_status,updated_at=now(),updated_by=auth.uid() WHERE id_request=p_request_id;
 INSERT INTO public.stocktrace_cashier_logs(id_request,id_user,action,note)
 VALUES(p_request_id,auth.uid(),'Status: '||v_old||' → '||p_status,btrim(p_note));
 RETURN jsonb_build_object('ok',true,'id_request',p_request_id,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_update_cashier_status(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_update_cashier_status(text,text,text) TO authenticated;
COMMIT;
-- QA setelah berhasil: SELECT count(*) FROM public.stocktrace_intakes; (tidak menghapus data)
