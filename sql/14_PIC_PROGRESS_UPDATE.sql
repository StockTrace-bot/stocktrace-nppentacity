-- StockTrace V2.2.1 — progres pemeriksaan PIC.
-- Jalankan sekali di Supabase SQL Editor pada project yang sama setelah backup.
-- Additive only: tidak mengubah status_kasus, tidak menghapus data, dan tidak mengubah webhook.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.cases') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.case_logs') IS NULL
     OR to_regprocedure('public.stocktrace_can_use_app()') IS NULL
     OR to_regprocedure('public.stocktrace_is_leader()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='cases' AND column_name='pic_id'
         AND udt_name='uuid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='cases' AND column_name='deleted_at'
     ) THEN
    RAISE EXCEPTION 'Preflight gagal: pastikan migrasi PIC, keamanan akun, dan arsip StockTrace sudah aktif.';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.stocktrace_pic_progress (
  id_kasus text PRIMARY KEY REFERENCES public.cases(id_kasus) ON DELETE RESTRICT,
  progress_status text NOT NULL
    CHECK (progress_status IN ('Sedang Diperiksa','Menunggu Informasi','Selesai Diperiksa')),
  progress_note text NOT NULL CHECK (length(btrim(progress_note)) BETWEEN 8 AND 2000),
  updated_by uuid NOT NULL REFERENCES public.users(id_user) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stocktrace_pic_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stocktrace_pic_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stocktrace_pic_progress TO authenticated;

DROP POLICY IF EXISTS st_pic_progress_read ON public.stocktrace_pic_progress;
CREATE POLICY st_pic_progress_read
  ON public.stocktrace_pic_progress
  FOR SELECT TO authenticated
  USING (
    public.stocktrace_can_use_app()
    AND EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id_kasus=stocktrace_pic_progress.id_kasus
        AND c.deleted_at IS NULL
        AND (
          public.stocktrace_is_leader()
          OR c.pic_id=auth.uid()
          OR c.id_pelapor=auth.uid()
        )
    )
  );

CREATE OR REPLACE FUNCTION public.stocktrace_update_pic_progress(
  p_case_id text,
  p_progress_status text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_pic uuid;
  v_case_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT public.stocktrace_can_use_app() THEN
    RAISE EXCEPTION 'Sesi tidak diizinkan atau kata sandi sementara belum diganti.' USING ERRCODE='42501';
  END IF;
  IF p_case_id IS NULL OR length(btrim(p_case_id)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'ID kasus tidak valid.' USING ERRCODE='22023';
  END IF;
  IF p_progress_status IS NULL OR p_progress_status NOT IN ('Sedang Diperiksa','Menunggu Informasi','Selesai Diperiksa') THEN
    RAISE EXCEPTION 'Progres pemeriksaan tidak dikenal.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Catatan progres wajib 8–2000 karakter.' USING ERRCODE='22023';
  END IF;

  SELECT c.pic_id,c.status_kasus
    INTO v_pic,v_case_status
  FROM public.cases c
  WHERE c.id_kasus=p_case_id AND c.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kasus tidak ditemukan atau sudah diarsipkan.' USING ERRCODE='P0002';
  END IF;
  IF v_pic IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Hanya PIC yang ditugaskan pada kasus ini yang dapat memperbarui progres.' USING ERRCODE='42501';
  END IF;
  IF v_case_status='Selesai' THEN
    RAISE EXCEPTION 'Kasus sudah diselesaikan oleh Leader; progres tidak dapat diubah.' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.stocktrace_pic_progress(
    id_kasus,progress_status,progress_note,updated_by,updated_at
  )
  VALUES(p_case_id,p_progress_status,btrim(p_note),auth.uid(),v_now)
  ON CONFLICT(id_kasus) DO UPDATE SET
    progress_status=EXCLUDED.progress_status,
    progress_note=EXCLUDED.progress_note,
    updated_by=EXCLUDED.updated_by,
    updated_at=EXCLUDED.updated_at;

  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(
    p_case_id,auth.uid(),
    'Pembaruan progres PIC: '||p_progress_status,
    btrim(p_note),v_now
  );

  RETURN jsonb_build_object(
    'ok',true,
    'case_id',p_case_id,
    'progress_status',p_progress_status,
    'updated_at',v_now
  );
END
$function$;

REVOKE ALL ON FUNCTION public.stocktrace_update_pic_progress(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_update_pic_progress(text,text,text) TO authenticated;

COMMIT;
