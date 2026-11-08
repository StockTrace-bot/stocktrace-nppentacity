-- StockTrace V2.1 — add Drive Trash webhooks for evidence metadata DELETE.
-- Reuses the existing authenticated Supabase Sheets webhook URL, method, headers,
-- and timeout. The secret is copied internally from pg_trigger.tgargs and is never printed.
-- This does NOT modify the existing eight Sheets webhooks.
-- Run only after api/drive-delete.mjs is deployed to the same Vercel Preview deployment.

BEGIN;
DO $$
DECLARE
  v_tgargs bytea;
  v_args text[];
  v_url text;
  v_method text;
  v_headers text;
  v_params text;
  v_timeout text;
  v_delete_url text;
  v_expected integer;
BEGIN
  SELECT t.tgargs
    INTO v_tgargs
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'cases'
    AND t.tgname = 'stocktrace_v21_staging_cases_sync'
    AND NOT t.tgisinternal
  LIMIT 1;

  IF v_tgargs IS NULL THEN
    RAISE EXCEPTION 'Webhook cases StockTrace tidak ditemukan. Tidak ada perubahan dilakukan.';
  END IF;

  -- Supabase http_request stores its five arguments as NUL-delimited trigger args.
  v_args := string_to_array(encode(v_tgargs, 'escape'), E'\\000');
  IF coalesce(array_length(v_args, 1), 0) < 5 THEN
    RAISE EXCEPTION 'Konfigurasi webhook cases tidak dapat dibaca. Tidak ada perubahan dilakukan.';
  END IF;

  v_url := v_args[1];
  v_method := v_args[2];
  v_headers := v_args[3];
  v_params := v_args[4];
  v_timeout := v_args[5];

  IF v_method <> 'POST'
     OR v_url !~ '^https://[^/]+/api/sheets-sync$'
     OR position('git-v2-1-staging' in v_url) = 0
     OR lower(v_headers) NOT LIKE '%x-stocktrace-sync-secret%'
     OR lower(v_headers) NOT LIKE '%content-type%application/json%' THEN
    RAISE EXCEPTION 'Webhook cases tidak mengarah ke Preview staging atau header autentikasinya tidak cocok. Tidak ada perubahan dilakukan.';
  END IF;

  -- Ensure all eight Sheets webhooks share the same endpoint and authentication headers.
  SELECT count(*) INTO v_expected
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'cases','case_logs','evidence_files','stocktrace_intakes',
      'stocktrace_intake_items','stocktrace_intake_evidence',
      'stocktrace_cashier_requests','stocktrace_cashier_logs'
    )
    AND t.tgname IN (
      'stocktrace_v21_staging_cases_sync','stocktrace_v21_staging_case_logs_sync',
      'stocktrace_v21_staging_evidence_sync','stocktrace_v21_staging_intakes_sync',
      'stocktrace_v21_staging_intake_items_sync','stocktrace_v21_staging_intake_evidence_sync',
      'stocktrace_v21_staging_cashier_requests_sync','stocktrace_v21_staging_cashier_logs_sync'
    )
    AND NOT t.tgisinternal
    AND t.tgargs = v_tgargs;

  IF v_expected <> 8 THEN
    RAISE EXCEPTION 'Delapan webhook Sheets tidak memiliki konfigurasi URL/header yang identik (ditemukan %). Audit manual diperlukan; tidak ada perubahan dilakukan.', v_expected;
  END IF;

  v_delete_url := regexp_replace(v_url, '/api/sheets-sync$', '/api/drive-delete');

  IF to_regclass('public.evidence_files') IS NULL
     OR to_regclass('public.stocktrace_intake_evidence') IS NULL THEN
    RAISE EXCEPTION 'Tabel bukti R1 atau penerimaan tidak ditemukan. Tidak ada perubahan dilakukan.';
  END IF;

  DROP TRIGGER IF EXISTS stocktrace_drive_delete_evidence ON public.evidence_files;
  DROP TRIGGER IF EXISTS stocktrace_drive_delete_intake_evidence ON public.stocktrace_intake_evidence;

  EXECUTE format(
    'CREATE TRIGGER %I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'stocktrace_drive_delete_evidence', 'evidence_files',
    v_delete_url, v_method, v_headers, v_params, v_timeout
  );
  EXECUTE format(
    'CREATE TRIGGER %I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'stocktrace_drive_delete_intake_evidence', 'stocktrace_intake_evidence',
    v_delete_url, v_method, v_headers, v_params, v_timeout
  );
END $$;
COMMIT;

-- Read-only verification: only the two new Drive DELETE triggers are shown.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  CASE t.tgenabled WHEN 'O' THEN 'ENABLED' WHEN 'D' THEN 'DISABLED' ELSE t.tgenabled::text END AS status,
  (t.tgtype::int & 8) = 8 AS fires_on_delete,
  substring(pg_get_triggerdef(t.oid, true) FROM $$'(https?://[^']+)'$$) AS endpoint_url
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname IN ('stocktrace_drive_delete_evidence','stocktrace_drive_delete_intake_evidence')
ORDER BY c.relname;
