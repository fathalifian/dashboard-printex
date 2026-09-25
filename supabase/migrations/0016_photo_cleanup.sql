-- Safe, retryable cleanup. Actual file deletion always uses the Storage API.
BEGIN;
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
COMMIT;
