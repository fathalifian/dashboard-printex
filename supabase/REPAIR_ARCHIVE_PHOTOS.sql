-- Repair missing photo dependencies. Requires the existing online schema (0013).
-- Safe to rerun; existing orders, history and photos are preserved.
BEGIN;

-- 0015_order_photos.sql
-- Optional private order photos. Requires migration 0013 and Supabase Storage.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('order-photos','order-photos',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS order_photos_read ON storage.objects;
CREATE POLICY order_photos_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='order-photos' AND public.printex_staff());
DROP POLICY IF EXISTS order_photos_upload ON storage.objects;
CREATE POLICY order_photos_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='order-photos' AND public.printex_admin()
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id::text=split_part(name,'/',1) AND o.archived_at IS NULL));
-- Images use new unique paths, never overwrite an image referenced by an order.
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='order-photos' AND public.printex_admin()
  AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=storage.objects.name));

CREATE OR REPLACE FUNCTION public.printex_set_order_photo(p_order_id uuid,p_expected_version bigint,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF o.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Foto order arsip tidak dapat diubah'; END IF;
  IF o.photo_path IS NOT DISTINCT FROM p_path THEN RETURN; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ ('^'||p_order_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
      RAISE EXCEPTION 'Lokasi foto tidak valid';
    END IF;
    -- Lock against cleanup while linking the uploaded object to the order.
    PERFORM 1 FROM storage.objects WHERE bucket_id='order-photos' AND name=p_path FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Foto belum diunggah'; END IF;
  END IF;
  UPDATE public.orders SET photo_path=p_path WHERE id=p_order_id;
END $$;
REVOKE ALL ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) TO authenticated;

-- 0016_photo_cleanup.sql
-- Safe, retryable cleanup. Actual file deletion always uses the Storage API.
CREATE TABLE IF NOT EXISTS public.order_photo_cleanup (
  path text PRIMARY KEY,
  claimed boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_photo_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_photo_cleanup FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS orders_photo_path_idx ON public.orders(photo_path) WHERE photo_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.printex_queue_old_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.photo_path IS NOT NULL AND (TG_OP='DELETE' OR OLD.photo_path IS DISTINCT FROM NEW.photo_path) THEN
    INSERT INTO public.order_photo_cleanup(path) VALUES(OLD.photo_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS orders_queue_old_photo ON public.orders;
CREATE TRIGGER orders_queue_old_photo AFTER DELETE OR UPDATE OF photo_path ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.printex_queue_old_photo();

CREATE OR REPLACE FUNCTION public.printex_claim_photo_cleanup(p_path text DEFAULT NULL)
RETURNS TABLE(path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat membersihkan foto' USING ERRCODE='42501'; END IF;
  -- A missing object after a successful API deletion needs no remaining queue row.
  DELETE FROM public.order_photo_cleanup q WHERE q.queued_at < now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=q.path);
  FOR candidate IN
    SELECT s.name FROM storage.objects s
    WHERE s.bucket_id='order-photos'
      AND (CASE WHEN p_path IS NOT NULL THEN s.name=p_path ELSE
        s.created_at < now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=s.name) END)
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=s.name)
    ORDER BY s.created_at,s.name LIMIT 50
  LOOP
    -- The photo-link RPC takes the same lock. After this claim it cannot attach the path.
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate,16));
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=candidate) THEN
      INSERT INTO public.order_photo_cleanup AS q(path,claimed) VALUES(candidate,true)
        ON CONFLICT ON CONSTRAINT order_photo_cleanup_pkey DO UPDATE SET claimed=true;
      path:=candidate; RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.printex_claim_photo_cleanup(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_claim_photo_cleanup(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.printex_photo_deletable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.printex_admin()
    AND EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=p_path AND q.claimed)
    AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=p_path);
$$;
REVOKE ALL ON FUNCTION public.printex_photo_deletable(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_photo_deletable(text) TO authenticated;
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='order-photos' AND public.printex_photo_deletable(name));

CREATE OR REPLACE FUNCTION public.printex_set_order_photo(p_order_id uuid,p_expected_version bigint,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  IF p_path IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_path,16));
    IF EXISTS(SELECT 1 FROM public.order_photo_cleanup WHERE path=p_path AND claimed) THEN
      RAISE EXCEPTION 'Foto sudah dijadwalkan untuk dibersihkan. Unggah ulang foto.';
    END IF;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF o.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Foto order arsip tidak dapat diubah'; END IF;
  IF o.photo_path IS NOT DISTINCT FROM p_path THEN RETURN; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ ('^'||p_order_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN RAISE EXCEPTION 'Lokasi foto tidak valid'; END IF;
    PERFORM 1 FROM storage.objects WHERE bucket_id='order-photos' AND name=p_path FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Foto belum diunggah'; END IF;
  END IF;
  UPDATE public.orders SET photo_path=p_path WHERE id=p_order_id;
  DELETE FROM public.order_photo_cleanup WHERE path=p_path AND NOT claimed;
END $$;
REVOKE ALL ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) TO authenticated;

-- 0019_archive_photo_cleanup.sql
-- Requires 0015 and 0016. Applies to orders finalized after this migration.
CREATE OR REPLACE FUNCTION public.enforce_order_archiving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text;
BEGIN
  -- Only FK-triggered removal of user references may update finalized archives.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    IF (to_jsonb(NEW) - 'created_by' - 'assigned_designer_id' - 'updated_at' - 'version')
      = (to_jsonb(OLD) - 'created_by' - 'assigned_designer_id' - 'updated_at' - 'version')
      AND (NEW.created_by IS NULL OR NEW.created_by IS NOT DISTINCT FROM OLD.created_by)
      AND (NEW.assigned_designer_id IS NULL OR NEW.assigned_designer_id IS NOT DISTINCT FROM OLD.assigned_designer_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF current_setting('printex.importing',true) = 'yes' THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT code INTO previous_code FROM public.production_steps WHERE id = OLD.current_step_id;
    IF previous_code = 'ARCHIVE' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Preserve archived orders and reports';
      END IF;
      IF (to_jsonb(NEW) - 'archive_finalized_at' - 'updated_at' - 'version')
         IS DISTINCT FROM (to_jsonb(OLD) - 'archive_finalized_at' - 'updated_at' - 'version') THEN
        RAISE EXCEPTION 'Archived order data is read-only';
      END IF;
      IF OLD.archive_finalized_at IS NOT NULL THEN
        RETURN OLD; -- repeated clicks cannot change the original report date
      END IF;
      IF NEW.archive_finalized_at IS NOT NULL THEN
        IF OLD.archived_at IS NULL OR OLD.delivery_method IS NULL THEN
          RAISE EXCEPTION 'Delivery confirmation is required before finalization';
        END IF;
        NEW.archive_finalized_at := statement_timestamp();
        NEW.photo_path := NULL; -- Release the photo only when leaving the board for reports.
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.archive_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Move to the archive board before finalizing';
  END IF;
  SELECT code INTO next_code FROM public.production_steps WHERE id = NEW.current_step_id;
  IF next_code = 'ARCHIVE' THEN
    IF TG_OP = 'INSERT' OR previous_code IS DISTINCT FROM 'DONE' THEN
      RAISE EXCEPTION 'Only Done orders can be archived';
    END IF;
    IF NEW.delivery_method IS NULL OR NEW.delivery_method NOT IN ('pickup', 'delivery') THEN
      RAISE EXCEPTION 'Confirm pickup or delivery before archiving';
    END IF;
    NEW.archived_at := statement_timestamp();
    NEW.order_state := 'completed';
  ELSIF NEW.archived_at IS NOT NULL OR NEW.delivery_method IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery metadata is only valid for archived orders';
  END IF;
  RETURN NEW;
END;
$$;

-- UPDATE OF photo_path would miss a path cleared inside a BEFORE trigger.
DROP TRIGGER IF EXISTS orders_queue_old_photo ON public.orders;
CREATE TRIGGER orders_queue_old_photo AFTER DELETE OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.printex_queue_old_photo();
COMMIT;
