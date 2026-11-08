-- BAHAYA: penghapusan DATA OPERASIONAL permanen; hanya jalankan setelah:
-- 1) dump SQL lengkap dan restore teruji, 2) inventaris Drive diverifikasi,
-- 3) Drive files terdaftar sudah dipindahkan ke sampah, 4) persetujuan final.
-- Script ini DIKUNCI (gagal secara sengaja) sampai token persetujuan diganti.
BEGIN;
DO $$ BEGIN
 IF 'BELUM_DIAKTIFKAN' <> 'PERSETUJUAN_RESET_KASUS_TERDOKUMENTASI' THEN
   RAISE EXCEPTION 'Reset terkunci. Jangan jalankan di produksi sebelum semua bukti dan backup diverifikasi.';
 END IF;
 IF (SELECT count(*) FROM public.users WHERE lower(btrim(role))='staff') <> 4 OR
    (SELECT count(*) FROM public.users WHERE lower(btrim(role))='leader') <> 1 THEN
   RAISE EXCEPTION 'Profil akun tidak sesuai; reset dibatalkan.';
 END IF;
END $$;
DELETE FROM public.case_logs;
DELETE FROM public.evidence_files;
DELETE FROM public.cases;
-- Tidak menyentuh public.users, auth.users, atau setting Google Drive.
COMMIT;
