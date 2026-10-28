-- STOCKTRACE INTEGRATED v1.1: migrasi untuk skema asli.
-- Menggunakan cases.status_kasus, case_logs.waktu_aksi, evidence_files.waktu_unggah.
-- Syarat: sudah ada BACKUP dan KEEMPAT tabel khusus StockTrace.
-- Migrasi mengganti policy RLS lama; aplikasi lain yang menggunakan tabel ini harus diuji.
-- Script berjalan satu transaksi: error => ROLLBACK, bukan setengah mengubah aturan.
BEGIN;

-- Pastikan struktur sesuai, hindari diam-diam membuat kolom yang salah.
DO $$
DECLARE expected_table text; expected_column text; missing_cols text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class tbl ON tbl.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=tbl.relnamespace
    WHERE n.nspname='public' AND tbl.relname IN ('cases','evidence_files')
      AND NOT t.tgisinternal AND (t.tgtype & 4)<>0
      AND t.tgname NOT IN ('st_log_cases_insert','st_log_evidence_insert')
  ) THEN RAISE EXCEPTION 'Sudah ada trigger INSERT lain di cases/evidence_files; pemeriksaan manual diperlukan.'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('users','cases','evidence_files','case_logs')
    AND policyname NOT IN (
      'Akses baca publik terautentikasi','Akses baca tulis cases','Akses baca tulis logs','Akses baca tulis evidence',
      'st_users_read','st_cases_read','st_cases_insert',
      'st_evidence_read','st_evidence_insert','st_logs_read','st_logs_insert'
    )
  ) THEN RAISE EXCEPTION 'Ditemukan policy RLS yang tidak dikenali. Periksa dulu agar tidak menimpa aturan proyek lain.'; END IF;
  FOR expected_table,expected_column IN SELECT t,c FROM (VALUES
    ('users','id_user'),('users','role'),('users','nama_lengkap'),
    ('cases','id_kasus'),('cases','id_pelapor'),('cases','sku_produk'),('cases','nama_produk'),
    ('cases','stok_sistem'),('cases','stok_fisik'),('cases','selisih'),('cases','dugaan_penyebab'),
    ('cases','kronologi'),('cases','status_kasus'),('cases','created_at'),
    ('evidence_files','id_kasus'),('evidence_files','nama_file_asli'),('evidence_files','drive_file_id'),('evidence_files','drive_view_url'),('evidence_files','waktu_unggah'),
    ('case_logs','id_kasus'),('case_logs','id_user'),('case_logs','aksi'),('case_logs','catatan'),('case_logs','waktu_aksi')
  ) AS x(t,c) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=expected_table AND column_name=expected_column) THEN
      missing_cols:=missing_cols||' '||expected_table||'.'||expected_column;
    END IF;
  END LOOP;
  IF missing_cols<>'' THEN RAISE EXCEPTION 'Kolom wajib tidak ditemukan:%',missing_cols; END IF;
END $$;

-- Fungsi membantu RLS tanpa rekursi membaca tabel users.
-- Tidak mengambil role dari browser. Dibuat oleh database admin/postgres.
CREATE OR REPLACE FUNCTION public.stocktrace_is_leader()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id_user=(SELECT auth.uid())
    AND lower(btrim(u.role)) IN ('leader','admin','store leader','store_leader')
); $$;
REVOKE ALL ON FUNCTION public.stocktrace_is_leader() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_is_leader() TO authenticated;

-- Lepas policy RLS lama yang sudah diidentifikasi dari hasil user.
DROP POLICY IF EXISTS "Akses baca publik terautentikasi" ON public.users;
DROP POLICY IF EXISTS "Akses baca tulis cases" ON public.cases;
DROP POLICY IF EXISTS "Akses baca tulis logs" ON public.case_logs;
DROP POLICY IF EXISTS "Akses baca tulis evidence" ON public.evidence_files;
-- Agar script bisa dijalankan ulang tanpa membuat policy duplikat.
DROP POLICY IF EXISTS st_users_read ON public.users;
DROP POLICY IF EXISTS st_cases_read ON public.cases;
DROP POLICY IF EXISTS st_cases_insert ON public.cases;
DROP POLICY IF EXISTS st_evidence_read ON public.evidence_files;
DROP POLICY IF EXISTS st_evidence_insert ON public.evidence_files;
DROP POLICY IF EXISTS st_logs_read ON public.case_logs;
DROP POLICY IF EXISTS st_logs_insert ON public.case_logs;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_logs ENABLE ROW LEVEL SECURITY;

-- User boleh membaca profilnya sendiri; Leader/Admin untuk menampilkan identitas pemeriksa.
CREATE POLICY st_users_read ON public.users FOR SELECT TO authenticated
USING (id_user=(SELECT auth.uid()) OR (SELECT public.stocktrace_is_leader()));
-- Staff: kasus miliknya sendiri. Leader/Admin: seluruh kasus.
CREATE POLICY st_cases_read ON public.cases FOR SELECT TO authenticated
USING (id_pelapor=(SELECT auth.uid()) OR (SELECT public.stocktrace_is_leader()));
CREATE POLICY st_cases_insert ON public.cases FOR INSERT TO authenticated
WITH CHECK (
  id_pelapor=(SELECT auth.uid()) AND status_kasus='Baru Dilaporkan'
  AND stok_sistem>=0 AND stok_fisik>=0 AND selisih=stok_fisik-stok_sistem AND selisih<>0
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id_user=(SELECT auth.uid())
    AND lower(btrim(u.role)) IN ('staff','leader','admin','store leader','store_leader'))
);
-- File terhubung ke kasus; akses mengikuti kebijakan SELECT cases.
CREATE POLICY st_evidence_read ON public.evidence_files FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=evidence_files.id_kasus));
CREATE POLICY st_evidence_insert ON public.evidence_files FOR INSERT TO authenticated
WITH CHECK (EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=evidence_files.id_kasus));
CREATE POLICY st_logs_read ON public.case_logs FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=case_logs.id_kasus));
-- Log audit hanya ditulis oleh trigger dan RPC, bukan langsung dari browser.
CREATE OR REPLACE FUNCTION public.stocktrace_log_case_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(NEW.id_kasus,NEW.id_pelapor,'Membuat laporan selisih stok',
         'Laporan baru dibuat. Tindak lanjut menunggu pemeriksaan.',now());
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.stocktrace_log_evidence_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(NEW.id_kasus,auth.uid(),'Menambah bukti',
         'Berkas: '||coalesce(NEW.nama_file_asli,'(tanpa nama)'),now());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS st_log_cases_insert ON public.cases;
CREATE TRIGGER st_log_cases_insert AFTER INSERT ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.stocktrace_log_case_insert();
DROP TRIGGER IF EXISTS st_log_evidence_insert ON public.evidence_files;
CREATE TRIGGER st_log_evidence_insert AFTER INSERT ON public.evidence_files
FOR EACH ROW EXECUTE FUNCTION public.stocktrace_log_evidence_insert();
REVOKE ALL ON FUNCTION public.stocktrace_log_case_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocktrace_log_evidence_insert() FROM PUBLIC, anon, authenticated;

-- GRANT lama termasuk DELETE/TRUNCATE/UPDATE/REFERENCES harus dibatasi.
REVOKE ALL ON TABLE public.users,public.cases,public.evidence_files,public.case_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT,INSERT ON public.cases TO authenticated;
GRANT SELECT,INSERT ON public.evidence_files TO authenticated;
GRANT SELECT ON public.case_logs TO authenticated;

-- RPC tunggal: memvalidasi Leader/Admin, menyimpan status_kasus dan log waktu_aksi atomik.
CREATE OR REPLACE FUNCTION public.stocktrace_update_case_status(p_case_id text,p_status text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE old_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.stocktrace_is_leader() THEN
    RAISE EXCEPTION 'Hanya Leader/Admin yang boleh memperbarui status' USING ERRCODE='42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN (
    'Baru Dilaporkan','Dalam Pemeriksaan','Menunggu Tindak Lanjut IT/MD','Dalam Penyelesaian','Selesai'
  ) THEN RAISE EXCEPTION 'Status tidak dikenal' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p_note,'')))<8 OR length(p_note)>2000 THEN
    RAISE EXCEPTION 'Catatan wajib 8 sampai 2000 karakter' USING ERRCODE='22023';
  END IF;
  SELECT status_kasus INTO old_status FROM public.cases
  WHERE id_kasus=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kasus tidak ditemukan' USING ERRCODE='P0002'; END IF;
  UPDATE public.cases SET status_kasus=p_status WHERE id_kasus=p_case_id;
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(p_case_id,auth.uid(),
    CASE WHEN p_status IS DISTINCT FROM old_status THEN
      'Perubahan status: '||coalesce(old_status,'Belum tercatat')||' → '||p_status
    ELSE 'Catatan tindak lanjut' END,
    btrim(p_note),now());
  RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_update_case_status(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_update_case_status(text,text,text) TO authenticated;
COMMIT;
