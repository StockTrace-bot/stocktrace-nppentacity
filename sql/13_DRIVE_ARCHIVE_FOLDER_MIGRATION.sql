-- StockTrace V2.2.1 — move archived evidence into a dedicated Google Drive subfolder.
-- RUN ONCE in the same Production Supabase project AFTER deploying V2.2.1 source to Vercel.
-- The Drive API creates "ARSIP STOCKTRACE" automatically inside each existing evidence root folder.
-- This migration does not delete files, database rows, or change deleted_at timestamps.
BEGIN;

DO $drive_archive_folder_migration$
DECLARE
  v_tgargs bytea;
  v_args text[];
  v_url text;
  v_method text;
  v_headers text;
  v_params text;
  v_timeout text;
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
    AND t.tgname='stocktrace_soft_archive_drive_evidence'
    AND position('/api/drive-delete' IN encode(t.tgargs,'escape'))>0
  ORDER BY t.tgname
  LIMIT 1;

  IF v_tgargs IS NULL THEN
    RAISE EXCEPTION 'Trigger Drive bukti kasus tidak ditemukan. Pastikan SQL 12 sudah aktif dan trigger mengarah ke /api/drive-delete.';
  END IF;

  v_args:=string_to_array(encode(v_tgargs,'escape'),E'\\000');
  IF coalesce(array_length(v_args,1),0)<5 THEN
    RAISE EXCEPTION 'Argumen webhook Drive tidak dapat dibaca. Tidak ada trigger yang diubah.';
  END IF;
  v_url:=v_args[1]; v_method:=v_args[2]; v_headers:=v_args[3]; v_params:=v_args[4]; v_timeout:=v_args[5];

  IF v_method<>'POST'
     OR position('/api/drive-delete' IN v_url)=0
     OR lower(v_headers) NOT LIKE '%x-stocktrace-sync-secret%'
     OR lower(v_headers) NOT LIKE '%content-type%application/json%' THEN
    RAISE EXCEPTION 'Konfigurasi webhook Drive tidak valid. Tidak ada trigger yang diubah.';
  END IF;

  DROP TRIGGER IF EXISTS stocktrace_soft_archive_drive_evidence ON public.evidence_files;
  DROP TRIGGER IF EXISTS stocktrace_soft_archive_drive_intake_evidence ON public.stocktrace_intake_evidence;

  -- Distinct status changes still dispatch normally. Same-value archived updates are
  -- intentionally accepted for the one-time reconciliation below.
  EXECUTE format(
    'CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION supabase_functions.http_request(%L,%L,%L,%L,%L)',
    'stocktrace_soft_archive_drive_evidence','evidence_files',
    v_url,v_method,v_headers,v_params,v_timeout
  );
  EXECUTE format(
    'CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON public.%I FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION supabase_functions.http_request(%L,%L,%L,%L,%L)',
    'stocktrace_soft_archive_drive_intake_evidence','stocktrace_intake_evidence',
    v_url,v_method,v_headers,v_params,v_timeout
  );
END
$drive_archive_folder_migration$;

-- Backfill only evidence already marked archived in Supabase. The API recognizes
-- archived -> archived as a reconciliation request and moves old V2.2 files out
-- of the active folder. No timestamp or archive metadata is changed.
UPDATE public.evidence_files
SET deleted_at = deleted_at
WHERE deleted_at IS NOT NULL
  AND drive_file_id IS NOT NULL
  AND btrim(drive_file_id) <> '';

UPDATE public.stocktrace_intake_evidence
SET deleted_at = deleted_at
WHERE deleted_at IS NOT NULL
  AND drive_file_id IS NOT NULL
  AND btrim(drive_file_id) <> '';

COMMIT;

-- Read-only verification: both Drive triggers should be ENABLED and still target the API.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  CASE t.tgenabled WHEN 'O' THEN 'ENABLED' WHEN 'D' THEN 'DISABLED' ELSE t.tgenabled::text END AS trigger_status,
  position('/api/drive-delete' IN encode(t.tgargs,'escape')) > 0 AS endpoint_ok
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND t.tgname IN ('stocktrace_soft_archive_drive_evidence','stocktrace_soft_archive_drive_intake_evidence')
ORDER BY c.relname;
