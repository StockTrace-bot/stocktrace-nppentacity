-- StockTrace: policy baca seluruh kasus dalam satu proyek/gerai.
-- DOKUMENTASI KONFIGURASI PRODUKSI; sudah dijalankan di database StockTrace user.
-- JANGAN JALANKAN ULANG SECARA OTOMATIS di database yang sudah berfungsi.
-- Khusus satu gerai: semua akun Staff/Leader/Admin aktif membaca semua kasus.
-- Hak UPDATE/DELETE kasus tetap tidak diberikan ke role authenticated.
-- Jika nanti banyak gerai, buat kolom gerai_id dan batasi kebijakan SELECT per gerai.
BEGIN;
ALTER POLICY st_cases_read ON public.cases
USING (
  EXISTS (
    SELECT 1 FROM public.users AS u
    WHERE u.id_user=(SELECT auth.uid())
      AND lower(btrim(u.role)) IN ('staff','leader','admin','store leader','store_leader')
  )
);
COMMIT;
