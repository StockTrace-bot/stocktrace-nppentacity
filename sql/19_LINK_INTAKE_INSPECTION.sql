-- Preserve the source receipt across sessions; corrections inherit the same reference.
BEGIN;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS source_intake_id text REFERENCES public.stocktrace_intakes(id_intake) ON DELETE SET NULL;
GRANT INSERT (source_intake_id) ON public.cases TO authenticated;

CREATE OR REPLACE FUNCTION public.st_validate_inspection_intake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.source_intake_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.stocktrace_intakes h
  JOIN public.stocktrace_intake_items i ON i.id_intake=h.id_intake
  WHERE h.id_intake=NEW.source_intake_id AND h.deleted_at IS NULL AND i.deleted_at IS NULL
  AND upper(btrim(i.sku))=upper(btrim(NEW.sku_produk))
 ) THEN RAISE EXCEPTION 'SKU tidak sesuai dengan penerimaan aktif.' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.st_validate_inspection_intake() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS st_validate_inspection_intake ON public.cases;
CREATE TRIGGER st_validate_inspection_intake BEFORE INSERT ON public.cases FOR EACH ROW EXECUTE FUNCTION public.st_validate_inspection_intake();

CREATE UNIQUE INDEX IF NOT EXISTS st_one_open_inspection_per_intake_sku
 ON public.cases(source_intake_id,upper(btrim(sku_produk)))
 WHERE source_intake_id IS NOT NULL AND deleted_at IS NULL AND status_kasus<>'Selesai';

CREATE OR REPLACE FUNCTION public.st_inherit_inspection_intake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE origin text;
BEGIN
 IF NEW.id_kasus IS NULL THEN RETURN NEW; END IF;
 SELECT source_intake_id INTO origin FROM public.cases WHERE id_kasus=NEW.id_kasus;
 IF origin IS NOT NULL THEN
  IF NEW.id_intake IS NOT NULL AND NEW.id_intake IS DISTINCT FROM origin THEN
   RAISE EXCEPTION 'Penerimaan tidak sesuai dengan pemeriksaan.' USING ERRCODE='22023';
  END IF;
  NEW.id_intake:=origin;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.st_inherit_inspection_intake() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS st_inherit_inspection_intake ON public.stocktrace_cashier_requests;
CREATE TRIGGER st_inherit_inspection_intake BEFORE INSERT ON public.stocktrace_cashier_requests FOR EACH ROW EXECUTE FUNCTION public.st_inherit_inspection_intake();
COMMIT;
