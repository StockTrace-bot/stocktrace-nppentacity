-- BACA SAJA; tidak menghapus data. Jalankan setelah backup penuh tersedia.
SELECT 'cases' AS tabel,count(*) AS jumlah FROM public.cases
UNION ALL SELECT 'evidence_files',count(*) FROM public.evidence_files
UNION ALL SELECT 'case_logs',count(*) FROM public.case_logs
UNION ALL SELECT 'users',count(*) FROM public.users;
SELECT id_kasus,drive_file_id,nama_file_asli FROM public.evidence_files ORDER BY id_kasus,waktu_unggah;
