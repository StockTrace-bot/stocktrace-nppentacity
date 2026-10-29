-- Jalankan setelah sql/08 (staging). Menambahkan guard di SECURITY DEFINER RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.stocktrace_update_case_status(p_case_id text,p_status text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE old_status text;
BEGIN
  IF NOT public.stocktrace_can_use_app() THEN
    RAISE EXCEPTION 'Ubah kata sandi sementara sebelum mengakses laporan' USING ERRCODE='42501';
  END IF;
  IF auth.uid() IS NULL OR NOT public.stocktrace_is_leader() THEN
    RAISE EXCEPTION 'Hanya Leader/Admin yang boleh memperbarui status' USING ERRCODE='42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN (
    'Baru Dilaporkan','Dalam Pemeriksaan','Menunggu Tindak Lanjut IT/MD','Dalam Penyelesaian','Selesai'
  ) THEN RAISE EXCEPTION 'Status tidak dikenal' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p_note,'')))<8 OR length(p_note)>2000 THEN
    RAISE EXCEPTION 'Catatan wajib 8 sampai 2000 karakter' USING ERRCODE='22023';
  END IF;
  SELECT status_kasus INTO old_status FROM public.cases
  WHERE id_kasus=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kasus tidak ditemukan' USING ERRCODE='P0002'; END IF;
  UPDATE public.cases SET status_kasus=p_status WHERE id_kasus=p_case_id;
  INSERT INTO public.case_logs(id_kasus,id_user,aksi,catatan,waktu_aksi)
  VALUES(p_case_id,auth.uid(),
    CASE WHEN p_status IS DISTINCT FROM old_status THEN
      'Perubahan status: '||coalesce(old_status,'Belum tercatat')||' → '||p_status
    ELSE 'Catatan tindak lanjut' END,
    btrim(p_note),now());
  RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'status',p_status);
END $$;

CREATE OR REPLACE FUNCTION public.stocktrace_assign_pic(
    p_case_id text, p_pic_user_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE old_pic uuid; old_name text; new_name text;
BEGIN
  IF NOT public.stocktrace_can_use_app() THEN
    RAISE EXCEPTION 'Ubah kata sandi sementara sebelum mengakses laporan' USING ERRCODE='42501';
  END IF;
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
COMMIT;
