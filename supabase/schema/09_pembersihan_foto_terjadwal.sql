-- Pembersihan foto terjadwal (tiap 5 menit, diaktifkan dengan supabase/jobs/enable-photo-cleanup.sql).
-- Memakai pg_net dan Vault; keduanya baru dibutuhkan saat fungsi berjalan. Kredensial disimpan di Vault,
-- tidak pernah di file ini.

-- Permintaan hapus yang sudah dikirim; dikirim ulang setelah 4 menit bila file masih ada.
CREATE TABLE public.photo_cleanup_requests (
  path text PRIMARY KEY,
  request_id bigint NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_cleanup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_cleanup_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.printex_run_photo_cleanup() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text; endpoint text; api_key text; encoded text; request bigint; total integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('printex-scheduled-photo-cleanup',16)) THEN RETURN 0; END IF;
  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='printex_storage_url';
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name='printex_storage_cleanup_key';
  IF endpoint IS NULL OR api_key IS NULL THEN RAISE EXCEPTION 'Photo cleanup credentials are not configured'; END IF;
  IF endpoint !~ '^https://[a-z0-9]+\.supabase\.co$' THEN RAISE EXCEPTION 'Invalid Storage endpoint'; END IF;

  DELETE FROM public.order_photo_cleanup q WHERE q.queued_at<now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=q.path);
  DELETE FROM public.photo_cleanup_requests r WHERE r.requested_at<now()-interval '7 days'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=r.path);

  FOR candidate IN
    SELECT s.name FROM storage.objects s
    LEFT JOIN public.photo_cleanup_requests r ON r.path=s.name
    WHERE s.bucket_id='order-photos'
      AND (s.created_at<now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=s.name))
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=s.name)
      AND (r.requested_at IS NULL OR r.requested_at<now()-interval '4 minutes')
    ORDER BY r.requested_at NULLS FIRST,s.created_at,s.name LIMIT 50
  LOOP
    -- Kunci dan klaim yang sama dengan penautan foto.
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate,16));
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=candidate) THEN
      INSERT INTO public.order_photo_cleanup AS q(path,claimed) VALUES(candidate,true)
      ON CONFLICT(path) DO UPDATE SET claimed=true;
      -- Encode UTF-8 per byte, pemisah folder dipertahankan.
      SELECT string_agg(CASE WHEN chr(b) ~ '^[A-Za-z0-9_~/.-]$' THEN chr(b) ELSE '%'||upper(lpad(to_hex(b),2,'0')) END,'' ORDER BY n)
      INTO encoded FROM (SELECT n,get_byte(convert_to(candidate,'UTF8'),n) AS b
        FROM generate_series(0,octet_length(convert_to(candidate,'UTF8'))-1) n) bytes;
      request := net.http_delete(
        url := endpoint||'/storage/v1/object/order-photos/'||encoded,
        headers := jsonb_build_object('apikey',api_key), timeout_milliseconds := 10000);
      INSERT INTO public.photo_cleanup_requests(path,request_id) VALUES(candidate,request)
      ON CONFLICT(path) DO UPDATE SET request_id=excluded.request_id,requested_at=now();
      total := total+1;
    END IF;
  END LOOP;
  -- pg_net mengirim setelah commit, jadi klaim tetap ada walau respons HTTP hilang.
  -- Penghapusan yang gagal dicoba lagi pada jadwal berikutnya; metadata Storage tidak pernah dihapus langsung.
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.printex_run_photo_cleanup() FROM PUBLIC,anon,authenticated;
