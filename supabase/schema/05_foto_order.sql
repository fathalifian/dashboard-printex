-- Foto order opsional di bucket privat 'order-photos' (JPG/PNG/WebP, maks. 5 MB).
-- Owner/Admin mengunggah dan menautkan; semua karyawan aktif bisa melihat. File lama dihapus aman
-- lewat Storage API setelah diklaim di antrean pembersihan (tidak pernah menghapus metadata Storage).

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('order-photos','order-photos',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];

-- Antrean foto yang dilepas dari order; claimed=true berarti boleh dihapus dan tidak bisa ditautkan lagi.
CREATE TABLE public.order_photo_cleanup (
  path text PRIMARY KEY,
  claimed boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_photo_cleanup ENABLE ROW LEVEL SECURITY;

-- Foto lama masuk antrean saat diganti, dilepas saat arsip final, atau order dihapus.
CREATE FUNCTION public.printex_queue_old_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.photo_path IS NOT NULL AND (TG_OP='DELETE' OR OLD.photo_path IS DISTINCT FROM NEW.photo_path) THEN
    INSERT INTO public.order_photo_cleanup(path) VALUES(OLD.photo_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER orders_queue_old_photo AFTER DELETE OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.printex_queue_old_photo();

CREATE FUNCTION public.printex_set_order_photo(p_order_id uuid, p_expected_version bigint, p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  IF p_path IS NOT NULL THEN
    -- Kunci yang sama dipakai pembersihan: foto yang sudah diklaim tidak bisa ditautkan lagi.
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

-- Klaim foto yatim untuk dihapus oleh server: p_path tertentu (unggahan gagal) atau maks. 50 foto yang
-- ada di antrean atau berumur lebih dari 24 jam tanpa order.
CREATE FUNCTION public.printex_claim_photo_cleanup(p_path text DEFAULT NULL)
RETURNS TABLE(path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat membersihkan foto' USING ERRCODE='42501'; END IF;
  -- File yang sudah terhapus tidak perlu baris antrean lagi.
  DELETE FROM public.order_photo_cleanup q WHERE q.queued_at<now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=q.path);
  FOR candidate IN
    SELECT s.name FROM storage.objects s
    WHERE s.bucket_id='order-photos'
      AND (CASE WHEN p_path IS NOT NULL THEN s.name=p_path
        ELSE s.created_at<now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=s.name) END)
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=s.name)
    ORDER BY s.created_at,s.name LIMIT 50
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate,16));
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=candidate) THEN
      -- Nama constraint, karena 'path' juga nama kolom hasil fungsi ini.
      INSERT INTO public.order_photo_cleanup AS q(path,claimed) VALUES(candidate,true)
        ON CONFLICT ON CONSTRAINT order_photo_cleanup_pkey DO UPDATE SET claimed=true;
      path := candidate; RETURN NEXT;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.printex_photo_deletable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.printex_admin()
    AND EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=p_path AND q.claimed)
    AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=p_path);
$$;

DROP POLICY IF EXISTS order_photos_read ON storage.objects;
CREATE POLICY order_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='order-photos' AND public.printex_staff());
-- Unggahan memakai path baru yang unik di folder order yang belum diarsipkan.
DROP POLICY IF EXISTS order_photos_upload ON storage.objects;
CREATE POLICY order_photos_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='order-photos' AND public.printex_admin()
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id::text=split_part(name,'/',1) AND o.archived_at IS NULL));
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='order-photos' AND public.printex_photo_deletable(name));
