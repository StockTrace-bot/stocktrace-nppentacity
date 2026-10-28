-- Read-only. Jalankan di SQL Editor Supabase; jangan membagikan hasil berisi data pribadi.
SELECT table_name,column_name,data_type,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name IN('users','cases','case_logs','evidence_files')
ORDER BY table_name,ordinal_position;
SELECT tablename,policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN('users','cases','case_logs','evidence_files')
ORDER BY tablename,policyname;
SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('users','cases','case_logs','evidence_files');
-- Trigger INSERT yang sudah ada; kirim hanya nama trigger (bukan isi tabel) bila perlu.
SELECT tbl.relname AS tabel,t.tgname AS trigger_name
FROM pg_trigger t JOIN pg_class tbl ON tbl.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=tbl.relnamespace
WHERE n.nspname='public' AND tbl.relname IN ('cases','evidence_files')
AND NOT t.tgisinternal AND (t.tgtype & 4)<>0
ORDER BY tbl.relname,t.tgname;
