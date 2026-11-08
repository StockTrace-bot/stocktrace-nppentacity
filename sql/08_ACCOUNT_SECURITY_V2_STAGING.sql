-- StockTrace V2 — pengamanan password sementara. STAGING FIRST.
-- Tambahan saja. Tidak menghapus akun/riwayat dan TIDAK mengganti identitas Auth.
-- Periksa skema, backup SQL, dan kebijakan RLS sebelum menjalankan.
BEGIN;
CREATE TABLE IF NOT EXISTS public.stocktrace_account_security (
 id_user uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 must_change_password boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_password_change_at timestamptz
);
REVOKE ALL ON public.stocktrace_account_security FROM PUBLIC, anon, authenticated;
ALTER TABLE public.stocktrace_account_security ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.stocktrace_account_security TO service_role;
INSERT INTO public.stocktrace_account_security(id_user)
 SELECT u.id_user FROM public.users u ON CONFLICT (id_user) DO NOTHING;
CREATE OR REPLACE FUNCTION public.stocktrace_can_use_app()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
 SELECT 1 FROM public.users u JOIN public.stocktrace_account_security a ON a.id_user=u.id_user
 WHERE u.id_user=(SELECT auth.uid()) AND NOT a.must_change_password
); $$;
REVOKE ALL ON FUNCTION public.stocktrace_can_use_app() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_can_use_app() TO authenticated;
-- RESTRICTIVE: existing permissive policies cannot bypass forced password-change guard.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['cases','evidence_files','case_logs'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS st_v2_password_ready ON public.%I',tbl);
  EXECUTE format('CREATE POLICY st_v2_password_ready ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.stocktrace_can_use_app()) WITH CHECK (public.stocktrace_can_use_app())',tbl);
 END LOOP;
END $$;
-- Atomic rate gate for verifying existing password; only server service_role can invoke.
CREATE TABLE IF NOT EXISTS public.stocktrace_password_attempts (
 id_key uuid PRIMARY KEY,
 opened_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0
);
REVOKE ALL ON public.stocktrace_password_attempts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.stocktrace_password_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.stocktrace_password_attempts TO service_role;
CREATE OR REPLACE FUNCTION public.stocktrace_password_gate(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.stocktrace_password_attempts(id_key,opened_at,attempts)
 VALUES(p_user_id,now(),1)
 ON CONFLICT(id_key) DO UPDATE SET
 attempts=CASE WHEN public.stocktrace_password_attempts.opened_at<now()-interval '15 minutes' THEN 1 ELSE public.stocktrace_password_attempts.attempts+1 END,
 opened_at=CASE WHEN public.stocktrace_password_attempts.opened_at<now()-interval '15 minutes' THEN now() ELSE public.stocktrace_password_attempts.opened_at END
 RETURNING attempts INTO n;
 RETURN n<=6;
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_password_gate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stocktrace_password_gate(uuid) TO service_role;
COMMIT;
-- Verifikasi: harus tepat 5 akun (tanpa meminta alamat email siapa pun).
SELECT u.nama_lengkap,u.role,u.login_id,a.must_change_password
 FROM public.users u LEFT JOIN public.stocktrace_account_security a ON a.id_user=u.id_user
 ORDER BY u.role,u.login_id;
