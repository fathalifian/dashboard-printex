-- Optional private order photos. Requires migration 0013 and Supabase Storage.
BEGIN;
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
COMMIT;
