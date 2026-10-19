-- Laporan harian tersimpan: kontribusi per order + total harian, diperbarui lewat antrean.
-- Hanya data turunan; order dan riwayat tidak pernah diubah dari sini.
-- Metrik: intake, intake_completed, output, paper, process, flow, timing, production, productivity, archive.

CREATE TABLE public.report_daily_summaries (
  report_date date NOT NULL,
  metric text NOT NULL,
  dimension text NOT NULL DEFAULT '',
  order_count bigint NOT NULL DEFAULT 0,
  meter numeric NOT NULL DEFAULT 0,
  milliseconds numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_date,metric,dimension)
);
CREATE TABLE public.report_contributions (
  order_id uuid NOT NULL,
  report_date date NOT NULL,
  metric text NOT NULL,
  dimension text NOT NULL DEFAULT '',
  meter numeric NOT NULL DEFAULT 0,
  milliseconds numeric NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (order_id,report_date,metric,dimension)
);
CREATE INDEX report_contributions_page ON public.report_contributions(metric,dimension,report_date DESC,order_id);
-- Data order disimpan sekali per order, bukan di setiap kontribusi.
CREATE TABLE public.report_order_payloads (
  order_id uuid PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE public.report_refresh_queue (
  order_id uuid PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_refresh_queue_oldest ON public.report_refresh_queue(queued_at,order_id);
ALTER TABLE public.report_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_order_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_refresh_queue ENABLE ROW LEVEL SECURITY;

-- Total harian mengikuti setiap perubahan kontribusi.
CREATE FUNCTION public.printex_report_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.report_contributions; sign integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    UPDATE public.report_daily_summaries
      SET order_count=order_count-CASE WHEN OLD.metric='flow' THEN (OLD.data->>'visits')::bigint ELSE 1 END,
          meter=meter-OLD.meter,milliseconds=milliseconds-OLD.milliseconds
      WHERE report_date=OLD.report_date AND metric=OLD.metric AND dimension=OLD.dimension;
  END IF;
  IF TG_OP='DELETE' THEN r:=OLD; sign:=-1; ELSE r:=NEW; sign:=1; END IF;
  INSERT INTO public.report_daily_summaries(report_date,metric,dimension,order_count,meter,milliseconds)
  VALUES(r.report_date,r.metric,r.dimension,sign*CASE WHEN r.metric='flow' THEN (r.data->>'visits')::bigint ELSE 1 END,
    sign*r.meter,sign*r.milliseconds)
  ON CONFLICT(report_date,metric,dimension) DO UPDATE SET
    order_count=public.report_daily_summaries.order_count+excluded.order_count,
    meter=public.report_daily_summaries.meter+excluded.meter,
    milliseconds=public.report_daily_summaries.milliseconds+excluded.milliseconds,updated_at=now();
  RETURN NULL;
END $$;
CREATE TRIGGER report_contribution_delta AFTER INSERT OR UPDATE OR DELETE ON public.report_contributions
  FOR EACH ROW EXECUTE FUNCTION public.printex_report_delta();

CREATE FUNCTION public.printex_compact_report_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.data ? 'order' AND NEW.data->'order'<>'null'::jsonb THEN
    INSERT INTO public.report_order_payloads(order_id,data) VALUES(NEW.order_id,NEW.data->'order')
    ON CONFLICT(order_id) DO UPDATE SET data=excluded.data WHERE public.report_order_payloads.data IS DISTINCT FROM excluded.data;
    NEW.data := jsonb_set(NEW.data,'{order}','null'::jsonb);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_compact_payload BEFORE INSERT OR UPDATE ON public.report_contributions
  FOR EACH ROW EXECUTE FUNCTION public.printex_compact_report_payload();

CREATE VIEW public.printex_report_expanded AS
SELECT c.order_id,c.report_date,c.metric,c.dimension,c.meter,c.milliseconds,
  CASE WHEN c.data ? 'order' AND p.order_id IS NOT NULL THEN jsonb_set(c.data,'{order}',p.data) ELSE c.data END AS data
FROM public.report_contributions c LEFT JOIN public.report_order_payloads p ON p.order_id=c.order_id;

-- Order, riwayat, dan nama customer yang berubah masuk antrean.
CREATE FUNCTION public.printex_queue_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; identity text;
BEGIN
  IF TG_TABLE_NAME='process_history' THEN
    identity := CASE WHEN TG_OP='DELETE' THEN OLD.order_identity ELSE NEW.order_identity END;
    oid := CASE WHEN identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN identity::uuid END;
  ELSE
    oid := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  END IF;
  IF oid IS NOT NULL THEN
    INSERT INTO public.report_refresh_queue(order_id) VALUES(oid) ON CONFLICT(order_id) DO UPDATE SET queued_at=now();
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER orders_queue_report AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.printex_queue_report();
CREATE TRIGGER history_queue_report AFTER INSERT OR UPDATE OR DELETE ON public.process_history
  FOR EACH ROW EXECUTE FUNCTION public.printex_queue_report();

CREATE FUNCTION public.printex_queue_customer_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.report_refresh_queue(order_id) SELECT id FROM public.orders WHERE customer_id=NEW.id
    ON CONFLICT(order_id) DO UPDATE SET queued_at=now();
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER customers_queue_report AFTER UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.printex_queue_customer_report();

CREATE FUNCTION public.printex_report_add(p_id uuid, p_day date, p_metric text, p_dimension text DEFAULT '',
  p_meter numeric DEFAULT 0, p_ms numeric DEFAULT 0, p_data jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.report_contributions(order_id,report_date,metric,dimension,meter,milliseconds,data)
  VALUES(p_id,p_day,p_metric,p_dimension,p_meter,p_ms,p_data)
  ON CONFLICT DO NOTHING;
$$;

-- Hitung ulang seluruh kontribusi satu order dari order dan riwayatnya (zona waktu Asia/Jakarta).
CREATE FUNCTION public.printex_refresh_report_order(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; customer text; events jsonb; e jsonb; code text; kind text;
  stamp timestamptz; started timestamptz; completed timestamptz; last_stamp timestamptz; ending timestamptz;
  open_code text; open_at timestamptz; flow_code text; flow_at timestamptz;
  durations jsonb:='{}'; exits jsonb:='{}'; visited jsonb:='{}'; ms numeric; day date; dim text;
  payload jsonb; order_data jsonb; base jsonb; is_finished boolean; timing_code text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id=p_id;
  DELETE FROM public.report_contributions WHERE order_id=p_id;
  DELETE FROM public.report_order_payloads WHERE order_id=p_id;
  -- Order yang dihapus tetap punya milestone proses selama riwayatnya ada.
  IF o.id IS NULL AND NOT EXISTS(SELECT 1 FROM public.process_history WHERE order_identity=p_id::text) THEN RETURN; END IF;
  SELECT name INTO customer FROM public.customers WHERE id=o.customer_id;
  order_data := jsonb_build_object('id',o.id,'spk_code',o.spk_code,'customer',jsonb_build_object('name',coalesce(customer,''),'phone',''),
    'production_type',o.production_type,'meter',coalesce(o.meter,0),'paper_width',o.paper_width,'customer_type',o.customer_type,
    'order_date',o.order_date,'due_at',o.due_at,'order_state',o.order_state,'photo_path',o.photo_path,
    'archive',CASE WHEN o.archived_at IS NULL THEN NULL ELSE jsonb_build_object('archivedAt',o.archived_at,
      'finalizedAt',o.archive_finalized_at,'deliveryMethod',o.delivery_method) END);
  -- Riwayat ringkas dibuka menjadi kejadian (tahap ditinggalkan + tahap tujuan).
  SELECT coalesce(jsonb_agg(t.data ORDER BY t.stamp,(t.kind='entered')::integer,t.id),'[]') INTO events FROM (
    SELECT h.id,h.occurred_at AS stamp,h.event_kind AS kind,
      jsonb_build_object('id',h.id,'code',s.code,'kind',h.event_kind,'at',h.occurred_at,'customer',h.customer_name,'spk',h.spk_code) AS data
    FROM public.process_history h JOIN public.production_steps s ON s.id=h.step_id WHERE h.order_identity=p_id::text
    UNION ALL
    SELECT h.next_event_id,h.occurred_at,'entered',
      jsonb_build_object('id',h.next_event_id,'code',s.code,'kind','entered','at',h.occurred_at,'customer',h.customer_name,'spk',h.spk_code)
    FROM public.process_history h JOIN public.production_steps s ON s.id=h.next_step_id WHERE h.order_identity=p_id::text
  ) t;
  -- Milestone selesai pertama per tahap (proses, output cetak, kertas).
  FOR e IN SELECT DISTINCT ON (value->>'code') value FROM jsonb_array_elements(events)
    WHERE value->>'kind'='completed' AND value->>'code' NOT IN ('DONE','ARCHIVE')
    ORDER BY value->>'code',(value->>'at')::timestamptz,value->>'id' LOOP
    code := e->>'code'; stamp := (e->>'at')::timestamptz; day := (stamp AT TIME ZONE 'Asia/Jakarta')::date;
    base := jsonb_build_object('id',e->>'id','orderId',p_id,'spkCode',e->>'spk','customerName',coalesce(e->>'customer',''),
      'kind','completed','orderExists',o.id IS NOT NULL,'occurredAt',stamp,'actorName',NULL);
    PERFORM public.printex_report_add(p_id,day,'process',code,0,0,jsonb_build_object('event',base));
    IF code='PRINTING' AND o.id IS NOT NULL THEN
      dim := CASE WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE 'sublim' END;
      PERFORM public.printex_report_add(p_id,day,'output',dim,greatest(o.meter,0));
      dim := CASE WHEN upper(trim(o.production_type))='DTF' THEN '0.6'
        WHEN o.paper_width IN (1.2,1.6,1.8) THEN trim(trailing '0' FROM o.paper_width::text) ELSE 'unknown' END;
      dim := CASE WHEN dim IN ('1.2','1.6','1.8','0.6') THEN dim ELSE 'unknown' END;
      PERFORM public.printex_report_add(p_id,day,'paper',dim,greatest(o.meter,0));
    END IF;
  END LOOP;
  IF o.id IS NULL THEN RETURN; END IF;
  PERFORM public.printex_report_add(p_id,o.order_date,'intake','');
  IF o.order_state='completed' OR o.archive_finalized_at IS NOT NULL THEN
    PERFORM public.printex_report_add(p_id,o.order_date,'intake_completed','');
  END IF;
  IF o.archive_finalized_at IS NOT NULL THEN
    day := (o.archive_finalized_at AT TIME ZONE 'Asia/Jakarta')::date;
    PERFORM public.printex_report_add(p_id,day,'archive','',greatest(o.meter,0),0,jsonb_build_object('order',order_data));
    base := jsonb_build_object('id','archive-completed-'||p_id,'orderId',p_id,'spkCode',o.spk_code,'customerName',coalesce(customer,''),
      'kind','completed','orderExists',true,'occurredAt',o.archive_finalized_at,'actorName',NULL);
    PERFORM public.printex_report_add(p_id,day,'process','DONE',0,0,jsonb_build_object('event',base));
  END IF;
  SELECT min((value->>'at')::timestamptz) FILTER(WHERE value->>'kind'='entered' AND value->>'code' IN ('DESIGN','DESIGN_DONE')),
    min((value->>'at')::timestamptz) FILTER(WHERE value->>'kind'='entered' AND value->>'code'='DONE'),
    max((value->>'at')::timestamptz)
  INTO started,completed,last_stamp FROM jsonb_array_elements(events);
  is_finished := completed IS NOT NULL OR (SELECT s.code IN ('DONE','ARCHIVE') FROM public.production_steps s WHERE s.id=o.current_step_id);
  ending := coalesce(completed,last_stamp);
  FOR e IN SELECT value FROM jsonb_array_elements(events) LOOP
    code := e->>'code'; kind := e->>'kind'; stamp := (e->>'at')::timestamptz;
    -- Rata-rata alur menghitung semua kunjungan nyata; kembali ke tahap sebelumnya bukan penyelesaian.
    IF flow_code IS NOT NULL AND (kind='entered' OR flow_code=code) AND NOT(kind='entered' AND flow_code=code) THEN
      IF kind='completed' OR (kind='entered'
         AND (SELECT s.sequence FROM public.production_steps s WHERE s.code=e->>'code')>(SELECT s.sequence FROM public.production_steps s WHERE s.code=flow_code)) THEN
        day := (stamp AT TIME ZONE 'Asia/Jakarta')::date;
        INSERT INTO public.report_contributions(order_id,report_date,metric,dimension,milliseconds,data)
        VALUES(p_id,day,'flow',flow_code,greatest(extract(epoch FROM stamp-flow_at)*1000,0),jsonb_build_object('visits',1))
        ON CONFLICT(order_id,report_date,metric,dimension) DO UPDATE SET
          milliseconds=public.report_contributions.milliseconds+excluded.milliseconds,
          data=jsonb_build_object('visits',(public.report_contributions.data->>'visits')::integer+1);
      END IF;
      flow_code := NULL;
    END IF;
    IF kind='entered' AND flow_code IS DISTINCT FROM code THEN flow_code := code; flow_at := stamp; END IF;
    IF started IS NULL OR stamp<started OR stamp>ending THEN CONTINUE; END IF;
    IF (kind<>'entered' AND open_code=code) OR (kind='entered' AND open_code IS NOT NULL AND open_code IS DISTINCT FROM code) THEN
      ms := greatest(extract(epoch FROM least(stamp,ending)-open_at)*1000,0);
      durations := jsonb_set(durations,ARRAY[open_code],to_jsonb(coalesce((durations->>open_code)::numeric,0)+ms));
      exits := jsonb_set(exits,ARRAY[open_code],to_jsonb(least(stamp,ending))); open_code := NULL;
    END IF;
    IF kind='entered' AND code IN ('DESIGN','DESIGN_DONE','PRINTING','PRESS') AND open_code IS DISTINCT FROM code THEN
      open_code := code; open_at := stamp; visited := jsonb_set(visited,ARRAY[code],'true');
    END IF;
  END LOOP;
  IF open_code IS NOT NULL AND is_finished THEN
    durations := jsonb_set(durations,ARRAY[open_code],
      to_jsonb(coalesce((durations->>open_code)::numeric,0)+greatest(extract(epoch FROM ending-open_at)*1000,0)));
    IF completed IS NOT NULL THEN exits := jsonb_set(exits,ARRAY[open_code],to_jsonb(completed)); END IF;
  END IF;
  payload := jsonb_build_object('order',order_data,'productionMilliseconds',
    CASE WHEN started IS NOT NULL AND completed IS NOT NULL THEN greatest(extract(epoch FROM completed-started)*1000,0) END);
  IF started IS NOT NULL AND completed IS NOT NULL THEN
    day := (completed AT TIME ZONE 'Asia/Jakarta')::date;
    PERFORM public.printex_report_add(p_id,day,'production','',0,greatest(extract(epoch FROM completed-started)*1000,0),payload);
  END IF;
  -- Waktu per tahap dan produktivitas cetak/press (meter per jam per jenis kertas).
  FOREACH timing_code IN ARRAY ARRAY['DESIGN','DESIGN_DONE','PRINTING','PRESS'] LOOP
    IF visited ? timing_code AND exits ? timing_code AND NOT(coalesce(NOT is_finished AND open_code=timing_code,false)) THEN
      day := ((exits->>timing_code)::timestamptz AT TIME ZONE 'Asia/Jakarta')::date;
      ms := coalesce((durations->>timing_code)::numeric,0);
      PERFORM public.printex_report_add(p_id,day,'timing',timing_code,0,ms,payload);
      IF timing_code IN ('PRINTING','PRESS') THEN
        dim := CASE WHEN timing_code='PRESS' THEN 'press' WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE 'sublim' END;
        PERFORM public.printex_report_add(p_id,day,'productivity',
          dim||':'||CASE WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE coalesce((o.paper_width::float8)::text,'unknown') END,
          greatest(o.meter,0),ms);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Pekerja latar (pg_cron tiap menit): proses maks. 500 order dari antrean.
CREATE FUNCTION public.printex_refresh_report_queue(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; refreshed integer:=0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(73621,1) THEN RETURN -1; END IF;
  FOR r IN SELECT order_id FROM public.report_refresh_queue ORDER BY queued_at,order_id
    LIMIT least(greatest(p_limit,1),500) FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.printex_refresh_report_order(r.order_id);
    DELETE FROM public.report_refresh_queue WHERE order_id=r.order_id;
    refreshed := refreshed+1;
  END LOOP;
  RETURN refreshed;
END $$;

-- Total harian untuk halaman Laporan; ikut memproses 100 antrean agar data terbaru langsung terlihat.
CREATE FUNCTION public.printex_daily_report(p_start date, p_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; pending boolean; result jsonb;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 THEN RAISE EXCEPTION 'Rentang laporan tidak valid'; END IF;
  IF pg_try_advisory_xact_lock(73621,1) THEN
    FOR r IN SELECT order_id FROM public.report_refresh_queue ORDER BY queued_at,order_id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
      PERFORM public.printex_refresh_report_order(r.order_id);
      DELETE FROM public.report_refresh_queue WHERE order_id=r.order_id;
    END LOOP;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.report_refresh_queue) INTO pending;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',report_date,'metric',metric,'dimension',dimension,'count',order_count,
    'meter',meter,'milliseconds',milliseconds) ORDER BY report_date,metric,dimension),'[]') INTO result
  FROM public.report_daily_summaries WHERE report_date BETWEEN p_start AND p_end AND order_count>0;
  RETURN jsonb_build_object('rows',result,'pending',pending,'asOf',now());
END $$;

-- Rincian satu metrik/dimensi (arsip, proses, waktu tahap, produksi), dengan pencarian SPK/customer.
CREATE FUNCTION public.printex_report_details(p_start date, p_end date, p_metric text, p_dimension text DEFAULT '',
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; total bigint;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 OR p_metric IS NULL
     OR p_metric NOT IN ('archive','process','timing','production') OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'Filter laporan tidak valid';
  END IF;
  SELECT count(*) INTO total FROM public.printex_report_expanded
  WHERE report_date BETWEEN p_start AND p_end AND metric=p_metric AND dimension=p_dimension
    AND (p_search='' OR position(lower(p_search) IN lower(coalesce(data->'order'->>'spk_code',data->'event'->>'spkCode','')
      ||' '||coalesce(data->'order'->'customer'->>'name',data->'event'->>'customerName','')))>0);
  SELECT coalesce(jsonb_agg(t.data),'[]') INTO result FROM (
    SELECT data||jsonb_build_object('milliseconds',milliseconds,'day',report_date) AS data FROM public.printex_report_expanded
    WHERE report_date BETWEEN p_start AND p_end AND metric=p_metric AND dimension=p_dimension
      AND (p_search='' OR position(lower(p_search) IN lower(coalesce(data->'order'->>'spk_code',data->'event'->>'spkCode','')
        ||' '||coalesce(data->'order'->'customer'->>'name',data->'event'->>'customerName','')))>0)
    ORDER BY report_date DESC,order_id LIMIT least(greatest(p_limit,1),200) OFFSET p_offset) t;
  RETURN jsonb_build_object('items',result,'total',total);
END $$;

-- Antrean diproses tiap menit bila pg_cron tersedia (menjadwalkan ulang dengan nama sama aman).
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE 'SELECT cron.schedule(''printex-daily-report-refresh'',''* * * * *'',''SELECT public.printex_refresh_report_queue(500);'')';
  END IF;
END $$;
