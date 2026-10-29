-- StockTrace kandidat V2 - JALANKAN DI STAGING dahulu, sesudah backup.
-- ADDITIVE: tidak menghapus laporan, Auth user, email, atau UUID.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_id text;
CREATE UNIQUE INDEX IF NOT EXISTS st_users_login_id_uq ON public.users ((upper(login_id))) WHERE login_id IS NOT NULL;
DO $$
DECLARE n_staff int; n_leader int; populated int;
BEGIN
 SELECT count(*) INTO n_staff FROM public.users WHERE lower(btrim(role))='staff';
 SELECT count(*) INTO n_leader FROM public.users WHERE lower(btrim(role))='leader';
 SELECT count(*) INTO populated FROM public.users WHERE login_id IS NOT NULL;
 IF n_staff<>4 OR n_leader<>1 THEN RAISE EXCEPTION 'Membutuhkan tepat 4 Staff dan 1 Leader; ditemukan % / %',n_staff,n_leader; END IF;
 IF populated NOT IN (0,5) THEN RAISE EXCEPTION 'Sebagian ID sudah terisi; tinjau sebelum lanjut'; END IF;
 IF populated=0 THEN
  UPDATE public.users SET login_id='NP-LDR-001' WHERE lower(btrim(role))='leader';
  WITH numbered AS (SELECT id_user, row_number() OVER(ORDER BY lower(nama_lengkap),id_user) n FROM public.users WHERE lower(btrim(role))='staff')
  UPDATE public.users u SET login_id='NP-STF-'||lpad(numbered.n::text,3,'0') FROM numbered WHERE u.id_user=numbered.id_user;
 END IF;
 IF (SELECT count(distinct login_id) FROM public.users WHERE login_id IS NOT NULL)<>5 THEN
  RAISE EXCEPTION 'ID Pengguna tidak unik atau jumlah tidak sesuai';
 END IF;
END $$;
ALTER TABLE public.users ADD CONSTRAINT st_login_id_format CHECK (login_id IS NULL OR login_id ~ '^NP-(STF|LDR)-[0-9]{3}$') NOT VALID;
ALTER TABLE public.users VALIDATE CONSTRAINT st_login_id_format;
CREATE TABLE IF NOT EXISTS public.stocktrace_login_attempts (
 id_key text PRIMARY KEY,
 opened_at timestamptz NOT NULL DEFAULT now(),
 attempts int NOT NULL DEFAULT 0
);
REVOKE ALL ON TABLE public.stocktrace_login_attempts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.stocktrace_login_attempts ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.stocktrace_login_gate(p_login_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
 END IF;
 IF p_login_id !~ '^NP-(STF|LDR)-[0-9]{3}$' THEN RETURN false; END IF;
 INSERT INTO public.stocktrace_login_attempts(id_key,opened_at,attempts)
 VALUES(p_login_id,now(),1)
 ON CONFLICT(id_key) DO UPDATE SET
   attempts=CASE WHEN public.stocktrace_login_attempts.opened_at < now()-interval '15 min' THEN 1 ELSE public.stocktrace_login_attempts.attempts+1 END,
   opened_at=CASE WHEN public.stocktrace_login_attempts.opened_at < now()-interval '15 min' THEN now() ELSE public.stocktrace_login_attempts.opened_at END
 RETURNING attempts INTO n;
 RETURN n<=8;
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_login_gate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stocktrace_login_gate(text) TO service_role;
COMMIT;
-- BACA HASIL: jangan menukar nama/ID karyawan sebelum diuji.
SELECT nama_lengkap,role,login_id FROM public.users ORDER BY role,login_id;
