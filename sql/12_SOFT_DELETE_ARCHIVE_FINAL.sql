-- StockTrace V2.2 FINAL — soft delete, restore, audit, and Drive archive status.
-- RUN ONCE in the SAME Supabase production project after deploying the matching source code.
-- Non-destructive: no DELETE/TRUNCATE/DROP TABLE and no direct DELETE grant is added.
-- Existing Sheets webhooks are not replaced. Two additional UPDATE webhooks mark/unmark
-- Drive evidence appProperties.stocktrace_status (files remain recoverable in Drive).
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.stocktrace_is_leader()') IS NULL
     OR to_regprocedure('public.stocktrace_can_use_app()') IS NULL
     OR to_regprocedure('public.stocktrace_v21_member()') IS NULL
     OR to_regclass('public.cases') IS NULL
     OR to_regclass('public.evidence_files') IS NULL
     OR to_regclass('public.case_logs') IS NULL
     OR to_regclass('public.stocktrace_intakes') IS NULL
     OR to_regclass('public.stocktrace_intake_items') IS NULL
     OR to_regclass('public.stocktrace_intake_evidence') IS NULL
     OR to_regclass('public.stocktrace_cashier_requests') IS NULL
     OR to_regclass('public.stocktrace_cashier_logs') IS NULL THEN
    RAISE EXCEPTION 'Preflight gagal: pastikan SQL 01/02/08/09/10 dan seluruh tabel StockTrace sudah aktif.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='evidence_files'
      AND column_name='uploaded_by' AND udt_name<>'uuid'
  ) THEN
    RAISE EXCEPTION 'Kolom evidence_files.uploaded_by sudah ada tetapi bukan UUID. Hentikan dan tinjau skema manual.';
  END IF;
END
$preflight$;

-- Soft-delete metadata. Files in Drive are NOT permanently deleted.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

ALTER TABLE public.evidence_files
  ADD COLUMN IF NOT EXISTS uploaded_by uuid DEFAULT auth.uid() REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;
ALTER TABLE public.evidence_files ALTER COLUMN uploaded_by SET DEFAULT auth.uid();

ALTER TABLE public.stocktrace_intakes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

ALTER TABLE public.stocktrace_intake_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

ALTER TABLE public.stocktrace_intake_evidence
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

ALTER TABLE public.stocktrace_cashier_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id_user),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

CREATE INDEX IF NOT EXISTS st_cases_active_idx
  ON public.cases(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS st_cases_archived_idx
  ON public.cases(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_evidence_archived_idx
  ON public.evidence_files(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_intakes_archived_idx
  ON public.stocktrace_intakes(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_intake_items_archived_idx
  ON public.stocktrace_intake_items(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_intake_evidence_archived_idx
  ON public.stocktrace_intake_evidence(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_cashier_archived_idx
  ON public.stocktrace_cashier_requests(deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- Append-only audit trail for archive/restore operations.
CREATE TABLE IF NOT EXISTS public.stocktrace_archive_events (
  id_event uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('case','evidence','intake','intake_evidence','cashier_request')),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) BETWEEN 1 AND 160),
  action text NOT NULL CHECK (action IN ('archived','restored')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  actor_id uuid NOT NULL REFERENCES public.users(id_user),
  batch_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS st_archive_events_entity_idx
  ON public.stocktrace_archive_events(entity_type,entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS st_archive_events_created_idx
  ON public.stocktrace_archive_events(created_at DESC);
ALTER TABLE public.stocktrace_archive_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stocktrace_archive_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stocktrace_archive_events TO authenticated;
DROP POLICY IF EXISTS st_archive_events_leader_read ON public.stocktrace_archive_events;
CREATE POLICY st_archive_events_leader_read
  ON public.stocktrace_archive_events FOR SELECT TO authenticated
  USING (public.stocktrace_can_use_app() AND public.stocktrace_is_leader());

-- Active records are visible to all valid app users; archived records are visible to Leader only.
DROP POLICY IF EXISTS st_cases_read ON public.cases;
CREATE POLICY st_cases_read ON public.cases FOR SELECT TO authenticated
USING (deleted_at IS NULL OR public.stocktrace_is_leader());

DROP POLICY IF EXISTS st_evidence_read ON public.evidence_files;
CREATE POLICY st_evidence_read ON public.evidence_files FOR SELECT TO authenticated
USING (
  public.stocktrace_is_leader()
  OR (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id_kasus=evidence_files.id_kasus AND c.deleted_at IS NULL
    )
  )
);

-- Keep evidence INSERT column-scoped so clients cannot set archive metadata directly.
REVOKE INSERT ON public.evidence_files FROM PUBLIC,anon,authenticated;
GRANT INSERT (id_kasus,nama_file_asli,drive_file_id,drive_view_url,uploaded_by)
  ON public.evidence_files TO authenticated;
DROP POLICY IF EXISTS st_evidence_insert ON public.evidence_files;
CREATE POLICY st_evidence_insert ON public.evidence_files FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by=auth.uid()
  AND deleted_at IS NULL AND deleted_by IS NULL
  AND delete_reason IS NULL AND archive_batch_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id_kasus=evidence_files.id_kasus AND c.deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS st_logs_read ON public.case_logs;
CREATE POLICY st_logs_read ON public.case_logs FOR SELECT TO authenticated
USING (
  public.stocktrace_is_leader()
  OR EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id_kasus=case_logs.id_kasus AND c.deleted_at IS NULL
  )
);

-- V2.1 tables. Immutable cashier history remains visible for active requests,
-- and is available to Leader when its parent request is archived.
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stocktrace_intakes',
    'stocktrace_intake_items',
    'stocktrace_intake_evidence',
    'stocktrace_cashier_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS st_v21_read ON public.%I',t);
    EXECUTE format(
      'CREATE POLICY st_v21_read ON public.%I FOR SELECT TO authenticated
       USING (public.stocktrace_v21_member() AND (deleted_at IS NULL OR public.stocktrace_is_leader()))',
      t
    );
  END LOOP;
  DROP POLICY IF EXISTS st_v21_read ON public.stocktrace_cashier_logs;
  CREATE POLICY st_v21_read ON public.stocktrace_cashier_logs FOR SELECT TO authenticated
  USING (
    public.stocktrace_v21_member()
    AND EXISTS (
      SELECT 1 FROM public.stocktrace_cashier_requests r
      WHERE r.id_request=stocktrace_cashier_logs.id_request
        AND (r.deleted_at IS NULL OR public.stocktrace_is_leader())
    )
  );
END
$policies$;

-- Atomic archive action. Staff may only archive their own unassigned new case,
-- their own evidence, or their own cashier request that has not yet been processed.
-- Leader may archive any supported record. No authenticated user receives DELETE.
CREATE OR REPLACE FUNCTION public.stocktrace_archive_record(
  p_entity_type text,
  p_entity_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_leader boolean := public.stocktrace_is_leader();
  v_reason text := btrim(coalesce(p_reason,''));
  v_batch uuid := gen_random_uuid();
  v_deleted_at timestamptz := clock_timestamp();
  v_owner uuid;
  v_status text;
  v_pic uuid;
  v_parent text;
  v_existing timestamptz;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL OR NOT public.stocktrace_v21_member() THEN
    RAISE EXCEPTION 'Sesi tidak diizinkan atau kata sandi sementara belum diganti.' USING ERRCODE='42501';
  END IF;
  IF length(v_reason) NOT BETWEEN 8 AND 500 OR length(coalesce(p_entity_id,'')) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'ID atau alasan pengarsipan tidak valid. Alasan wajib 8–500 karakter.' USING ERRCODE='22023';
  END IF;

  CASE p_entity_type
    WHEN 'case' THEN
      SELECT id_pelapor,status_kasus,pic_id,deleted_at
        INTO v_owner,v_status,v_pic,v_existing
      FROM public.cases WHERE id_kasus=p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Laporan tidak ditemukan.' USING ERRCODE='P0002'; END IF;
      IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Laporan sudah berada di Arsip & Sampah.' USING ERRCODE='22023'; END IF;
      IF NOT v_leader AND NOT (v_owner=v_user AND v_status='Baru Dilaporkan' AND v_pic IS NULL) THEN
        RAISE EXCEPTION 'Staff hanya dapat mengarsipkan laporan miliknya yang masih Baru Dilaporkan dan belum memiliki PIC.' USING ERRCODE='42501';
      END IF;
      UPDATE public.cases
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason=v_reason,archive_batch_id=v_batch
        WHERE id_kasus=p_entity_id;
      UPDATE public.evidence_files
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason='Mengikuti pengarsipan laporan: '||v_reason,archive_batch_id=v_batch
        WHERE id_kasus=p_entity_id AND deleted_at IS NULL;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id,details)
        VALUES('case',p_entity_id,'archived',v_reason,v_user,v_batch,jsonb_build_object('evidence_archived',v_count));
      INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
        VALUES(p_entity_id,v_user,'Laporan diarsipkan',v_reason,now());
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'archived_evidence',v_count);

    WHEN 'evidence' THEN
      SELECT id_kasus,uploaded_by,deleted_at INTO v_parent,v_owner,v_existing
      FROM public.evidence_files WHERE id_file::text=p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bukti kasus tidak ditemukan.' USING ERRCODE='P0002'; END IF;
      IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Bukti sudah diarsipkan.' USING ERRCODE='22023'; END IF;
      IF NOT v_leader AND NOT EXISTS(
        SELECT 1 FROM public.cases c
        WHERE c.id_kasus=v_parent AND c.id_pelapor=v_user
          AND c.status_kasus='Baru Dilaporkan' AND c.pic_id IS NULL AND c.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Staff hanya dapat mengarsipkan bukti miliknya pada laporan baru yang belum memiliki PIC.' USING ERRCODE='42501';
      END IF;
      IF EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=v_parent AND c.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Pulihkan laporan induk terlebih dahulu sebelum mengarsipkan bukti secara terpisah.' USING ERRCODE='22023';
      END IF;
      UPDATE public.evidence_files
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason=v_reason,archive_batch_id=v_batch
        WHERE id_file::text=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('evidence',p_entity_id,'archived',v_reason,v_user,v_batch);
      INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
        VALUES(v_parent,v_user,'Bukti diarsipkan',v_reason,now());
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    WHEN 'intake' THEN
      IF NOT v_leader THEN RAISE EXCEPTION 'Hanya Leader dapat mengarsipkan dokumen penerimaan.' USING ERRCODE='42501'; END IF;
      SELECT deleted_at INTO v_existing FROM public.stocktrace_intakes WHERE id_intake=p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen penerimaan tidak ditemukan.' USING ERRCODE='P0002'; END IF;
      IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Dokumen penerimaan sudah diarsipkan.' USING ERRCODE='22023'; END IF;
      UPDATE public.stocktrace_intakes
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason=v_reason,archive_batch_id=v_batch
        WHERE id_intake=p_entity_id;
      UPDATE public.stocktrace_intake_items
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason='Mengikuti pengarsipan penerimaan: '||v_reason,archive_batch_id=v_batch
        WHERE id_intake=p_entity_id AND deleted_at IS NULL;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE public.stocktrace_intake_evidence
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason='Mengikuti pengarsipan penerimaan: '||v_reason,archive_batch_id=v_batch
        WHERE id_intake=p_entity_id AND deleted_at IS NULL;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id,details)
        VALUES('intake',p_entity_id,'archived',v_reason,v_user,v_batch,jsonb_build_object('items_archived',v_count));
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'archived_items',v_count);

    WHEN 'intake_evidence' THEN
      SELECT id_intake,uploaded_by,deleted_at INTO v_parent,v_owner,v_existing
      FROM public.stocktrace_intake_evidence WHERE id_file::text=p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bukti penerimaan tidak ditemukan.' USING ERRCODE='P0002'; END IF;
      IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Bukti penerimaan sudah diarsipkan.' USING ERRCODE='22023'; END IF;
      IF NOT v_leader THEN RAISE EXCEPTION 'Hanya Leader dapat mengarsipkan bukti penerimaan.' USING ERRCODE='42501'; END IF;
      IF EXISTS(SELECT 1 FROM public.stocktrace_intakes i WHERE i.id_intake=v_parent AND i.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Pulihkan dokumen penerimaan induk terlebih dahulu.' USING ERRCODE='22023';
      END IF;
      UPDATE public.stocktrace_intake_evidence
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason=v_reason,archive_batch_id=v_batch
        WHERE id_file::text=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('intake_evidence',p_entity_id,'archived',v_reason,v_user,v_batch);
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    WHEN 'cashier_request' THEN
      SELECT created_by,status_request,deleted_at INTO v_owner,v_status,v_existing
      FROM public.stocktrace_cashier_requests WHERE id_request=p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Permintaan kasir tidak ditemukan.' USING ERRCODE='P0002'; END IF;
      IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Permintaan kasir sudah diarsipkan.' USING ERRCODE='22023'; END IF;
      IF NOT v_leader AND NOT (v_owner=v_user AND v_status='Diajukan') THEN
        RAISE EXCEPTION 'Staff hanya dapat mengarsipkan permintaan miliknya yang masih berstatus Diajukan.' USING ERRCODE='42501';
      END IF;
      UPDATE public.stocktrace_cashier_requests
        SET deleted_at=v_deleted_at,deleted_by=v_user,delete_reason=v_reason,archive_batch_id=v_batch
        WHERE id_request=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('cashier_request',p_entity_id,'archived',v_reason,v_user,v_batch);
      INSERT INTO public.stocktrace_cashier_logs(id_request,id_user,action,note)
        VALUES(p_entity_id,v_user,'Permintaan diarsipkan',v_reason);
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    ELSE
      RAISE EXCEPTION 'Jenis data tidak didukung untuk pengarsipan.' USING ERRCODE='22023';
  END CASE;
END
$function$;

-- Restore is Leader-only. Parent restore also restores only its own cascade batch.
CREATE OR REPLACE FUNCTION public.stocktrace_restore_record(
  p_entity_type text,
  p_entity_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_batch uuid;
  v_parent text;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL OR NOT public.stocktrace_v21_member() OR NOT public.stocktrace_is_leader() THEN
    RAISE EXCEPTION 'Hanya Leader aktif yang dapat memulihkan data.' USING ERRCODE='42501';
  END IF;
  IF length(v_reason) NOT BETWEEN 8 AND 500 OR length(coalesce(p_entity_id,'')) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'ID atau alasan pemulihan tidak valid. Alasan wajib 8–500 karakter.' USING ERRCODE='22023';
  END IF;

  CASE p_entity_type
    WHEN 'case' THEN
      SELECT archive_batch_id INTO v_batch FROM public.cases
      WHERE id_kasus=p_entity_id AND deleted_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Laporan tidak ditemukan di Arsip & Sampah.' USING ERRCODE='P0002'; END IF;
      UPDATE public.cases SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
      WHERE id_kasus=p_entity_id;
      UPDATE public.evidence_files
        SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
        WHERE archive_batch_id=v_batch;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id,details)
        VALUES('case',p_entity_id,'restored',v_reason,v_user,v_batch,jsonb_build_object('evidence_restored',v_count));
      INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
        VALUES(p_entity_id,v_user,'Laporan dipulihkan',v_reason,now());
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'restored_evidence',v_count);

    WHEN 'evidence' THEN
      SELECT id_kasus,archive_batch_id INTO v_parent,v_batch FROM public.evidence_files
      WHERE id_file::text=p_entity_id AND deleted_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bukti kasus tidak ditemukan di Arsip & Sampah.' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.cases c WHERE c.id_kasus=v_parent AND c.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Pulihkan laporan induk terlebih dahulu.' USING ERRCODE='22023';
      END IF;
      UPDATE public.evidence_files SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
      WHERE id_file::text=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('evidence',p_entity_id,'restored',v_reason,v_user,v_batch);
      INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
        VALUES(v_parent,v_user,'Bukti dipulihkan',v_reason,now());
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    WHEN 'intake' THEN
      SELECT archive_batch_id INTO v_batch FROM public.stocktrace_intakes
      WHERE id_intake=p_entity_id AND deleted_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen penerimaan tidak ditemukan di Arsip & Sampah.' USING ERRCODE='P0002'; END IF;
      UPDATE public.stocktrace_intakes SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
      WHERE id_intake=p_entity_id;
      UPDATE public.stocktrace_intake_items
        SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
        WHERE archive_batch_id=v_batch;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE public.stocktrace_intake_evidence
        SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
        WHERE archive_batch_id=v_batch;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id,details)
        VALUES('intake',p_entity_id,'restored',v_reason,v_user,v_batch,jsonb_build_object('items_restored',v_count));
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'restored_items',v_count);

    WHEN 'intake_evidence' THEN
      SELECT id_intake,archive_batch_id INTO v_parent,v_batch FROM public.stocktrace_intake_evidence
      WHERE id_file::text=p_entity_id AND deleted_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bukti penerimaan tidak ditemukan di Arsip & Sampah.' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.stocktrace_intakes i WHERE i.id_intake=v_parent AND i.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Pulihkan dokumen penerimaan induk terlebih dahulu.' USING ERRCODE='22023';
      END IF;
      UPDATE public.stocktrace_intake_evidence SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
      WHERE id_file::text=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('intake_evidence',p_entity_id,'restored',v_reason,v_user,v_batch);
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    WHEN 'cashier_request' THEN
      SELECT archive_batch_id INTO v_batch FROM public.stocktrace_cashier_requests
      WHERE id_request=p_entity_id AND deleted_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Permintaan kasir tidak ditemukan di Arsip & Sampah.' USING ERRCODE='P0002'; END IF;
      UPDATE public.stocktrace_cashier_requests SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,archive_batch_id=NULL
      WHERE id_request=p_entity_id;
      INSERT INTO public.stocktrace_archive_events(entity_type,entity_id,action,reason,actor_id,batch_id)
        VALUES('cashier_request',p_entity_id,'restored',v_reason,v_user,v_batch);
      INSERT INTO public.stocktrace_cashier_logs(id_request,id_user,action,note)
        VALUES(p_entity_id,v_user,'Permintaan dipulihkan',v_reason);
      RETURN jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id);

    ELSE
      RAISE EXCEPTION 'Jenis data tidak didukung untuk pemulihan.' USING ERRCODE='22023';
  END CASE;
END
$function$;

REVOKE ALL ON FUNCTION public.stocktrace_archive_record(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.stocktrace_restore_record(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_archive_record(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stocktrace_restore_record(text,text,text) TO authenticated;

-- Add Drive UPDATE webhooks for evidence archive/restore. Copy the already-working
-- Sheets webhook endpoint, header and secret from evidence_files; do not print secrets.
DO $drive_webhooks$
DECLARE
  v_tgargs bytea;
  v_args text[];
  v_url text;
  v_method text;
  v_headers text;
  v_params text;
  v_timeout text;
  v_drive_url text;
BEGIN
  SELECT t.tgargs INTO v_tgargs
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid=t.tgfoid
  JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE t.tgrelid='public.evidence_files'::regclass
    AND NOT t.tgisinternal
    AND t.tgenabled='O'
    AND pn.nspname='supabase_functions'
    AND p.proname='http_request'
    AND t.tgname='stocktrace_sync_bukti'
    AND position('/api/sheets-sync' IN encode(t.tgargs,'escape'))>0
  ORDER BY t.tgname
  LIMIT 1;

  IF v_tgargs IS NULL THEN
    RAISE EXCEPTION 'Webhook Sheets evidence_files tidak ditemukan. Pastikan webhook R1 yang aktif sudah terpasang.';
  END IF;

  v_args:=string_to_array(encode(v_tgargs,'escape'),E'\\000');
  IF coalesce(array_length(v_args,1),0)<5 THEN
    RAISE EXCEPTION 'Argumen webhook Sheets tidak dapat dibaca. Tidak ada trigger Drive yang dibuat.';
  END IF;
  v_url:=v_args[1]; v_method:=v_args[2]; v_headers:=v_args[3]; v_params:=v_args[4]; v_timeout:=v_args[5];

  IF v_method<>'POST'
     OR v_url <> 'https://stocktrace-nppentacity.vercel.app/api/sheets-sync'
     OR lower(v_headers) NOT LIKE '%x-stocktrace-sync-secret%'
     OR lower(v_headers) NOT LIKE '%content-type%application/json%' THEN
    RAISE EXCEPTION 'Webhook sumber tidak valid. Tidak ada trigger Drive yang dibuat.';
  END IF;

  v_drive_url:=regexp_replace(v_url,'/api/sheets-sync$','/api/drive-delete');

  DROP TRIGGER IF EXISTS stocktrace_soft_archive_drive_evidence ON public.evidence_files;
  DROP TRIGGER IF EXISTS stocktrace_soft_archive_drive_intake_evidence ON public.stocktrace_intake_evidence;

  EXECUTE format(
    'CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) EXECUTE FUNCTION supabase_functions.http_request(%L,%L,%L,%L,%L)',
    'stocktrace_soft_archive_drive_evidence','evidence_files',
    v_drive_url,v_method,v_headers,v_params,v_timeout
  );
  EXECUTE format(
    'CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) EXECUTE FUNCTION supabase_functions.http_request(%L,%L,%L,%L,%L)',
    'stocktrace_soft_archive_drive_intake_evidence','stocktrace_intake_evidence',
    v_drive_url,v_method,v_headers,v_params,v_timeout
  );
END
$drive_webhooks$;

COMMIT;

-- Read-only verification: expect two ENABLED Drive archive triggers.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  CASE t.tgenabled WHEN 'O' THEN 'ENABLED' WHEN 'D' THEN 'DISABLED' ELSE t.tgenabled::text END AS status,
  (t.tgtype::int & 16) = 16 AS fires_on_update,
  position('/api/drive-delete' IN encode(t.tgargs,'escape')) > 0 AS endpoint_is_drive_delete
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND t.tgname IN ('stocktrace_soft_archive_drive_evidence','stocktrace_soft_archive_drive_intake_evidence')
ORDER BY c.relname;

-- Read-only QA: should return 0 for rows currently missing soft-delete metadata.
SELECT
  (SELECT count(*) FROM public.cases WHERE deleted_at IS NOT NULL AND (deleted_by IS NULL OR delete_reason IS NULL)) AS bad_archived_cases,
  (SELECT count(*) FROM public.evidence_files WHERE deleted_at IS NOT NULL AND (deleted_by IS NULL OR delete_reason IS NULL)) AS bad_archived_evidence,
  (SELECT count(*) FROM public.stocktrace_intakes WHERE deleted_at IS NOT NULL AND (deleted_by IS NULL OR delete_reason IS NULL)) AS bad_archived_intakes,
  (SELECT count(*) FROM public.stocktrace_cashier_requests WHERE deleted_at IS NOT NULL AND (deleted_by IS NULL OR delete_reason IS NULL)) AS bad_archived_cashier_requests;
