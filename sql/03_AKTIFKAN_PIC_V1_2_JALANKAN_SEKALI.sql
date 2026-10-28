-- STOCKTRACE v1.2 — FITUR PIC / 5 AKUN (4 Staff + 1 Leader)
-- KHUSUS DATABASE StockTrace yang sudah menjalankan migrasi v1.1.
-- Backup dahulu. Tidak ada DROP TABLE/DELETE/TRUNCATE; data lama dipertahankan.
-- Peran PIC adalah PENUGASAN, BUKAN ROLE BARU. Hanya Leader dapat memilihnya.
-- Jalankan sekali di Supabase SQL Editor sebagai administrator setelah baca README.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cases' AND column_name='id_pelapor')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='id_user')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cases' AND policyname='st_cases_insert')
     OR to_regprocedure('public.stocktrace_is_leader()') IS NULL
  THEN RAISE EXCEPTION 'Skema StockTrace v1.1 tidak ditemukan. Jangan jalankan migrasi PIC di database lain.'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cases' AND column_name='pic_id' AND udt_name <> 'uuid') THEN
    RAISE EXCEPTION 'Kolom pic_id sudah ada tetapi tipenya bukan UUID. Hentikan dan tinjau manual.';
  END IF;
END $$;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pic_id uuid,
  ADD COLUMN IF NOT EXISTS pic_nama text,
  ADD COLUMN IF NOT EXISTS pic_ditetapkan_pada timestamptz;
CREATE INDEX IF NOT EXISTS st_cases_pic_id_idx ON public.cases (pic_id);
COMMENT ON COLUMN public.cases.pic_id IS 'Akun Staff yang ditunjuk Leader untuk menangani kasus; NULL artinya belum ada PIC.';
COMMENT ON COLUMN public.cases.pic_nama IS 'Snapshot nama PIC saat ditugaskan agar audit tetap terbaca.';
COMMENT ON COLUMN public.cases.pic_ditetapkan_pada IS 'Tanggal/jam penugasan PIC terbaru dalam UTC.';

-- Staff bahkan tidak boleh menyelipkan PIC sewaktu membuat kasus via REST.
-- Grant INSERT dibatasi hanya kolom yang memang ada di formulir laporan.
REVOKE INSERT ON TABLE public.cases FROM PUBLIC, anon, authenticated;
GRANT INSERT (id_kasus,id_pelapor,sku_produk,nama_produk,stok_sistem,stok_fisik,selisih,
              dugaan_penyebab,kronologi,status_kasus) ON public.cases TO authenticated;
ALTER POLICY st_cases_insert ON public.cases WITH CHECK (
  id_pelapor=(SELECT auth.uid())
  AND status_kasus='Baru Dilaporkan'
  AND stok_sistem>=0 AND stok_fisik>=0
  AND selisih=stok_fisik-stok_sistem AND selisih<>0
  AND pic_id IS NULL AND pic_nama IS NULL AND pic_ditetapkan_pada IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id_user=(SELECT auth.uid())
    AND lower(btrim(u.role)) IN ('staff','leader','admin','store leader','store_leader'))
);

-- Directory minimal (nama + role) untuk mengidentifikasi pelapor/PIC.
-- Tidak membocorkan email/password, tidak membuka SELECT penuh atas tabel users.
CREATE OR REPLACE FUNCTION public.stocktrace_staff_directory()
RETURNS TABLE (id_user uuid, nama_lengkap text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users requester WHERE requester.id_user=auth.uid()
      AND lower(btrim(requester.role)) IN ('staff','leader','admin','store leader','store_leader')
  ) THEN RAISE EXCEPTION 'Akses daftar pengguna ditolak' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT u.id_user,u.nama_lengkap,u.role FROM public.users u
    WHERE lower(btrim(u.role)) IN ('staff','leader','admin','store leader','store_leader')
    ORDER BY lower(u.nama_lengkap),u.id_user;
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_staff_directory() TO authenticated;

-- Penugasan PIC + riwayat merupakan satu transaksi DB. Tidak mengubah status kasus.
CREATE OR REPLACE FUNCTION public.stocktrace_assign_pic(
    p_case_id text, p_pic_user_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE old_pic uuid; old_name text; new_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.stocktrace_is_leader() THEN
    RAISE EXCEPTION 'Hanya Leader/Admin yang boleh menetapkan PIC' USING ERRCODE='42501';
  END IF;
  IF p_case_id IS NULL OR length(btrim(p_case_id))=0 THEN
    RAISE EXCEPTION 'ID kasus wajib diisi' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_note,'')))<8 OR length(p_note)>2000 THEN
    RAISE EXCEPTION 'Catatan penugasan wajib 8 sampai 2000 karakter' USING ERRCODE='22023';
  END IF;
  SELECT c.pic_id,c.pic_nama INTO old_pic,old_name FROM public.cases c
  WHERE c.id_kasus=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kasus tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF p_pic_user_id IS NOT NULL THEN
    SELECT u.nama_lengkap INTO new_name FROM public.users u
    WHERE u.id_user=p_pic_user_id AND lower(btrim(u.role))='staff';
    IF NOT FOUND OR length(btrim(coalesce(new_name,'')))=0 THEN
      RAISE EXCEPTION 'PIC harus akun Staff yang terdaftar dan memiliki nama' USING ERRCODE='22023';
    END IF;
  ELSE
    new_name:=NULL;
  END IF;
  IF old_pic IS NOT DISTINCT FROM p_pic_user_id THEN
    RAISE EXCEPTION 'PIC tidak berubah. Pilih akun berbeda atau batalkan penugasan.' USING ERRCODE='22023';
  END IF;
  UPDATE public.cases SET pic_id=p_pic_user_id,pic_nama=new_name,
      pic_ditetapkan_pada=CASE WHEN p_pic_user_id IS NULL THEN NULL ELSE now() END
  WHERE id_kasus=p_case_id;
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(p_case_id,auth.uid(),
    'Penetapan PIC: '||coalesce(old_name,'Belum ditugaskan')||' → '||coalesce(new_name,'Belum ditugaskan'),
    btrim(p_note),now());
  RETURN jsonb_build_object('ok',true,'case_id',p_case_id,
      'pic_id',p_pic_user_id,'pic_name',new_name);
END $$;
REVOKE ALL ON FUNCTION public.stocktrace_assign_pic(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocktrace_assign_pic(text,uuid,text) TO authenticated;

COMMIT;
