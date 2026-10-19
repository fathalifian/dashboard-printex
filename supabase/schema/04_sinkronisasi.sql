-- Pemuatan dashboard: snapshot per periode dan sinkronisasi bertahap (hanya ID baris yang berubah).

-- Jam revisi global + revisi terakhir per baris. Baris yang dihapus tetap dicatat agar klien membuangnya.
CREATE TABLE public.printex_sync_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.printex_sync_clock(singleton) VALUES (true);
CREATE TABLE public.printex_row_changes (
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  revision bigint NOT NULL,
  deleted boolean NOT NULL,
  PRIMARY KEY (table_name,row_id)
);
CREATE INDEX printex_row_changes_revision ON public.printex_row_changes(revision);
ALTER TABLE public.printex_sync_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printex_row_changes ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.printex_record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rev bigint; item jsonb;
BEGIN
  -- Kunci baris jam ditahan sampai commit: kursor tidak bisa melewati transaksi yang commit belakangan.
  UPDATE public.printex_sync_clock SET revision=revision+1 WHERE singleton RETURNING revision INTO rev;
  item := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO public.printex_row_changes VALUES(TG_TABLE_NAME,(item->>'id')::uuid,rev,TG_OP='DELETE')
  ON CONFLICT(table_name,row_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
  RETURN NULL;
END $$;
CREATE TRIGGER printex_track_change AFTER INSERT OR UPDATE OR DELETE ON public.production_steps
  FOR EACH ROW EXECUTE FUNCTION public.printex_record_change();
CREATE TRIGGER printex_track_change AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.printex_record_change();
CREATE TRIGGER printex_track_change AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.printex_record_change();
CREATE TRIGGER printex_track_change AFTER INSERT OR UPDATE OR DELETE ON public.process_history
  FOR EACH ROW EXECUTE FUNCTION public.printex_record_change();

-- Kursor dan perubahan dibaca dalam satu snapshot. Lebih dari 2000 perubahan = klien memuat ulang penuh.
CREATE FUNCTION public.printex_sync_changes(p_after bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
  WITH delta AS (
    SELECT d.table_name,d.row_id FROM public.printex_row_changes d
    WHERE p_after IS NOT NULL AND d.revision>p_after LIMIT 2001
  ), summary AS (SELECT count(*) AS n FROM delta)
  SELECT jsonb_build_object('cursor',c.revision::text,'reset',summary.n>2000,'changes',
    CASE WHEN p_after IS NULL OR summary.n>2000 THEN '[]'::jsonb
    ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('table',d.table_name,'id',d.row_id)) FROM delta d),'[]'::jsonb) END)
  INTO result FROM public.printex_sync_clock c CROSS JOIN summary WHERE singleton;
  RETURN result;
END $$;

-- Data dashboard untuk satu periode: order aktif, order yang masuk/selesai di periode, order yang
-- diminta (p_order), dan riwayat lengkap order-order itu. Riwayat tahap arsip tidak dikirim.
-- p_changes membatasi ke baris yang berubah; riwayat dibagi per halaman 5000 baris
-- (p_history_after + p_history_ids, p_history_only melewati order/customer/tahap).
-- SECURITY INVOKER: RLS tabel tetap berlaku.
CREATE FUNCTION public.printex_scoped_snapshot(p_start date, p_end date, p_order uuid DEFAULT NULL,
  p_changes jsonb DEFAULT NULL, p_history_after uuid DEFAULT NULL, p_history_only boolean DEFAULT false,
  p_history_ids text[] DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result json; period_start timestamptz; period_end timestamptz;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 THEN RAISE EXCEPTION 'Rentang data tidak valid'; END IF;
  period_start := p_start::timestamp AT TIME ZONE 'Asia/Jakarta';
  period_end := (p_end+1)::timestamp AT TIME ZONE 'Asia/Jakarta';
  WITH selected_identity AS MATERIALIZED (
    SELECT unnest(p_history_ids) AS identity WHERE p_history_ids IS NOT NULL
    UNION
    SELECT o.id::text FROM public.orders o WHERE p_history_ids IS NULL AND
      (o.archive_finalized_at IS NULL OR o.order_date BETWEEN p_start AND p_end
       OR o.archive_finalized_at>=period_start AND o.archive_finalized_at<period_end
       OR o.id=p_order)
    UNION
    SELECT h.order_identity FROM public.process_history h WHERE p_history_ids IS NULL
      AND h.occurred_at>=period_start AND h.occurred_at<period_end
  ), selected_orders AS MATERIALIZED (
    SELECT o.id,o.customer_id FROM public.orders o JOIN selected_identity i ON i.identity=o.id::text
  ), changed AS MATERIALIZED (
    SELECT item->>'table' AS table_name,item->>'id' AS id FROM jsonb_array_elements(coalesce(p_changes,'[]'::jsonb)) item
  ), history_page AS MATERIALIZED (
    SELECT h.id,h.order_identity,h.spk_code,h.step_id,h.event_kind,h.occurred_at,h.customer_name,h.next_step_id,h.next_event_id
    FROM public.process_history h JOIN selected_identity i ON i.identity=h.order_identity
    WHERE (p_history_after IS NULL OR h.id>p_history_after)
      AND h.step_id NOT IN (SELECT id FROM public.production_steps WHERE code='ARCHIVE')
      AND (p_changes IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name='process_history' AND c.id=h.id::text))
    ORDER BY h.id LIMIT 5001
  ), history_rows AS MATERIALIZED (SELECT * FROM history_page ORDER BY id LIMIT 5000)
  SELECT json_build_object(
    'orders',CASE WHEN p_history_only THEN '[]'::json ELSE coalesce((SELECT json_agg(row_to_json(o))
      FROM public.orders o JOIN selected_orders s ON s.id=o.id
      WHERE p_changes IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name='orders' AND c.id=o.id::text)),'[]'::json) END,
    'customers',CASE WHEN p_history_only THEN '[]'::json ELSE coalesce((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'phone',t.phone))
      FROM public.customers t WHERE EXISTS(SELECT 1 FROM selected_orders o WHERE o.customer_id=t.id)
      AND (p_changes IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name='customers' AND c.id=t.id::text))),'[]'::json) END,
    'production_steps',CASE WHEN p_history_only THEN '[]'::json ELSE coalesce((SELECT json_agg(json_build_object('id',t.id,'code',t.code))
      FROM public.production_steps t
      WHERE p_changes IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name='production_steps' AND c.id=t.id::text)),'[]'::json) END,
    'process_history',coalesce((SELECT json_agg(json_build_object(
      'id',h.id,'order_identity',h.order_identity,'spk_code',h.spk_code,'step_id',h.step_id,
      'event_kind',h.event_kind,'occurred_at',h.occurred_at,'customer_name',h.customer_name,
      'next_step_id',h.next_step_id,'next_event_id',h.next_event_id)) FROM history_rows h),'[]'::json),
    'history_more',(SELECT count(*)>5000 FROM history_page),
    'history_cursor',(SELECT id FROM history_rows ORDER BY id DESC LIMIT 1),
    'identities',CASE WHEN p_history_only THEN '[]'::json ELSE coalesce((SELECT json_agg(identity) FROM selected_identity),'[]'::json) END
  ) INTO result;
  RETURN result;
END $$;

-- Realtime Supabase memberi tanda ada perubahan; datanya diambil lewat printex_sync_changes.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','customers','production_steps','orders','process_history'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
    END IF;
  END LOOP;
END $$;
