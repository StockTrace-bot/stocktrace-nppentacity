-- QA READ-ONLY. Jalankan setelah migrasi PIC dan setelah membuat akun individual.
-- Jangan menyalin alamat email staf ke chat publik.
SELECT lower(btrim(role)) AS role, count(*) AS jumlah_profil
FROM public.users
GROUP BY lower(btrim(role)) ORDER BY role;

SELECT c.id_kasus,c.status_kasus,c.pic_nama,c.pic_ditetapkan_pada,
       pelapor.nama_lengkap AS nama_pelapor
FROM public.cases c
LEFT JOIN public.users pelapor ON pelapor.id_user=c.id_pelapor
ORDER BY c.created_at DESC LIMIT 20;

SELECT proname,has_function_privilege('authenticated',oid,'EXECUTE') AS bisa_dipanggil_authenticated
FROM pg_proc WHERE oid IN (
  'public.stocktrace_staff_directory()'::regprocedure,
  'public.stocktrace_assign_pic(text,uuid,text)'::regprocedure
);
