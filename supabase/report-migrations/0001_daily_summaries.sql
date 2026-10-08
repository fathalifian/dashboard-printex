-- Derived reports only. Existing business records and histories are preserved.
BEGIN;
CREATE TABLE IF NOT EXISTS public.report_daily_summaries (
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 report_date date NOT NULL, metric text NOT NULL, dimension text NOT NULL DEFAULT '',
 order_count bigint NOT NULL DEFAULT 0, meter numeric NOT NULL DEFAULT 0,
 milliseconds numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(branch_id,report_date,metric,dimension)
);
CREATE INDEX IF NOT EXISTS report_daily_period ON public.report_daily_summaries(report_date,branch_id);
CREATE TABLE IF NOT EXISTS public.report_contributions (
 order_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 report_date date NOT NULL, metric text NOT NULL, dimension text NOT NULL DEFAULT '',
 meter numeric NOT NULL DEFAULT 0, milliseconds numeric NOT NULL DEFAULT 0,
 data jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(order_id,report_date,metric,dimension)
);
CREATE INDEX IF NOT EXISTS report_contributions_period ON public.report_contributions(branch_id,metric,dimension,report_date,order_id);
CREATE INDEX IF NOT EXISTS report_contributions_all_period ON public.report_contributions(metric,dimension,report_date,order_id);
CREATE TABLE IF NOT EXISTS public.report_refresh_queue (
 order_id uuid PRIMARY KEY, branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_refresh_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_daily_summaries,public.report_contributions,public.report_refresh_queue FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.printex_report_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.report_contributions; sign integer; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=coalesce(NEW.branch_id,OLD.branch_id)) THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' THEN
  UPDATE public.report_daily_summaries SET order_count=order_count-CASE WHEN OLD.metric='flow' THEN (OLD.data->>'visits')::bigint ELSE 1 END,meter=meter-OLD.meter,milliseconds=milliseconds-OLD.milliseconds WHERE branch_id=OLD.branch_id AND report_date=OLD.report_date AND metric=OLD.metric AND dimension=OLD.dimension;
 END IF;
 IF TG_OP='DELETE' THEN r:=OLD; sign:=-1; ELSE r:=NEW; sign:=1; END IF;
 INSERT INTO public.report_daily_summaries(branch_id,report_date,metric,dimension,order_count,meter,milliseconds)
 VALUES(r.branch_id,r.report_date,r.metric,r.dimension,sign*CASE WHEN r.metric='flow' THEN (r.data->>'visits')::bigint ELSE 1 END,sign*r.meter,sign*r.milliseconds)
 ON CONFLICT(branch_id,report_date,metric,dimension) DO UPDATE SET
 order_count=public.report_daily_summaries.order_count+excluded.order_count,
 meter=public.report_daily_summaries.meter+excluded.meter,
 milliseconds=public.report_daily_summaries.milliseconds+excluded.milliseconds,updated_at=now();
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS report_contribution_delta ON public.report_contributions;
CREATE TRIGGER report_contribution_delta AFTER INSERT OR UPDATE OR DELETE ON public.report_contributions FOR EACH ROW EXECUTE FUNCTION public.printex_report_delta();

CREATE OR REPLACE FUNCTION public.printex_queue_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; bid uuid; BEGIN
 IF TG_TABLE_NAME='process_history' THEN
  IF TG_OP='DELETE' THEN oid:=CASE WHEN OLD.order_identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN OLD.order_identity::uuid END; bid:=OLD.branch_id;
  ELSE oid:=CASE WHEN NEW.order_identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.order_identity::uuid END; bid:=NEW.branch_id; END IF;
 ELSE
  IF TG_OP='DELETE' THEN oid:=OLD.id; bid:=OLD.branch_id; ELSE oid:=NEW.id; bid:=NEW.branch_id; END IF;
 END IF;
 IF oid IS NOT NULL AND bid IS NOT NULL THEN
  INSERT INTO public.report_refresh_queue(order_id,branch_id) VALUES(oid,bid)
  ON CONFLICT(order_id) DO UPDATE SET branch_id=excluded.branch_id,queued_at=now();
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS orders_queue_report ON public.orders;
CREATE TRIGGER orders_queue_report AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.printex_queue_report();
DROP TRIGGER IF EXISTS history_queue_report ON public.process_history;
CREATE TRIGGER history_queue_report AFTER INSERT OR UPDATE OR DELETE ON public.process_history FOR EACH ROW EXECUTE FUNCTION public.printex_queue_report();


CREATE OR REPLACE FUNCTION public.printex_queue_customer_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.name IS DISTINCT FROM OLD.name THEN
  INSERT INTO public.report_refresh_queue(order_id,branch_id) SELECT id,branch_id FROM public.orders WHERE customer_id=NEW.id
  ON CONFLICT(order_id) DO UPDATE SET queued_at=now();
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS customers_queue_report ON public.customers;
CREATE TRIGGER customers_queue_report AFTER UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.printex_queue_customer_report();
REVOKE ALL ON FUNCTION public.printex_queue_customer_report() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.printex_report_add(p_id uuid,p_branch uuid,p_day date,p_metric text,p_dimension text DEFAULT '',p_meter numeric DEFAULT 0,p_ms numeric DEFAULT 0,p_data jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.report_contributions(order_id,branch_id,report_date,metric,dimension,meter,milliseconds,data)
 VALUES(p_id,p_branch,p_day,p_metric,p_dimension,p_meter,p_ms,p_data)
 ON CONFLICT DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.printex_refresh_report_order(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; bid uuid; customer text; events jsonb; e jsonb; code text; kind text;
 stamp timestamptz; started timestamptz; completed timestamptz; last_stamp timestamptz; ending timestamptz;
 open_code text; open_at timestamptz; flow_code text; flow_at timestamptz;
 durations jsonb:='{}'; exits jsonb:='{}'; visited jsonb:='{}'; ms numeric; day date; dim text;
 payload jsonb; order_data jsonb; base jsonb; is_finished boolean; timing_code text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_id;
 bid:=o.branch_id;
 IF bid IS NULL THEN SELECT branch_id INTO bid FROM public.process_history WHERE order_identity=p_id::text LIMIT 1; END IF;
 DELETE FROM public.report_contributions WHERE order_id=p_id;
 IF bid IS NULL THEN RETURN; END IF;
 SELECT name INTO customer FROM public.customers WHERE id=o.customer_id;
 order_data:=jsonb_build_object('id',o.id,'branch_id',bid,'spk_code',o.spk_code,'customer',jsonb_build_object('name',coalesce(customer,''),'phone',''),
  'production_type',o.production_type,'meter',coalesce(o.meter,0),'paper_width',o.paper_width,'customer_type',o.customer_type,
  'order_date',o.order_date,'due_at',o.due_at,'order_state',o.order_state,'photo_path',o.photo_path,
  'archive',CASE WHEN o.archived_at IS NULL THEN NULL ELSE jsonb_build_object('archivedAt',o.archived_at,'finalizedAt',o.archive_finalized_at,'deliveryMethod',o.delivery_method) END);
 SELECT coalesce(jsonb_agg(t.data ORDER BY t.stamp,(t.kind='entered')::integer,t.id),'[]') INTO events FROM (
  SELECT h.id,h.occurred_at AS stamp,h.event_kind AS kind,
   jsonb_build_object('id',h.id,'code',s.code,'kind',h.event_kind,'at',h.occurred_at,'actor',h.actor_name,'customer',h.customer_name,'spk',h.spk_code) AS data
  FROM public.process_history h JOIN public.production_steps s ON s.id=h.step_id WHERE h.order_identity=p_id::text
  UNION ALL
  SELECT h.next_event_id,h.occurred_at,'entered',
   jsonb_build_object('id',h.next_event_id,'code',s.code,'kind','entered','at',h.occurred_at,'actor',h.actor_name,'customer',h.customer_name,'spk',h.spk_code)
  FROM public.process_history h JOIN public.production_steps s ON s.id=h.next_step_id WHERE h.order_identity=p_id::text
 ) t;
 -- Original completion milestones: deduplicate before any date filtering.
 FOR e IN SELECT DISTINCT ON (value->>'code') value FROM jsonb_array_elements(events)
  WHERE value->>'kind'='completed' AND value->>'code' NOT IN ('DONE','ARCHIVE') ORDER BY value->>'code',(value->>'at')::timestamptz,value->>'id' LOOP
  code:=e->>'code'; stamp:=(e->>'at')::timestamptz; day:=(stamp AT TIME ZONE 'Asia/Jakarta')::date;
  base:=jsonb_build_object('id',e->>'id','orderId',p_id,'branchId',bid,'spkCode',e->>'spk','customerName',coalesce(e->>'customer',''),'kind','completed','orderExists',o.id IS NOT NULL,'occurredAt',stamp,'actorName',e->>'actor');
  PERFORM public.printex_report_add(p_id,bid,day,'process',code,0,0,jsonb_build_object('event',base));
  IF code='PRINTING' AND o.id IS NOT NULL THEN
   dim:=CASE WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE 'sublim' END;
   PERFORM public.printex_report_add(p_id,bid,day,'output',dim,greatest(o.meter,0));
   dim:=CASE WHEN upper(trim(o.production_type))='DTF' THEN '0.6' WHEN o.paper_width IN (1.2,1.6,1.8) THEN trim(trailing '0' FROM o.paper_width::text) ELSE 'unknown' END;
   dim:=CASE WHEN dim IN ('1.2','1.6','1.8','0.6') THEN dim ELSE 'unknown' END;
   PERFORM public.printex_report_add(p_id,bid,day,'paper',dim,greatest(o.meter,0));
  END IF;
 END LOOP;
 IF o.id IS NULL THEN RETURN; END IF;
 PERFORM public.printex_report_add(p_id,bid,o.order_date,'intake','');
 IF o.order_state<>'cancelled' AND (o.order_state='completed' OR o.archive_finalized_at IS NOT NULL) THEN
  PERFORM public.printex_report_add(p_id,bid,o.order_date,'intake_completed','');
 END IF;
 IF o.archive_finalized_at IS NOT NULL THEN
  day:=(o.archive_finalized_at AT TIME ZONE 'Asia/Jakarta')::date;
  PERFORM public.printex_report_add(p_id,bid,day,'archive','',greatest(o.meter,0),0,jsonb_build_object('order',order_data));
  base:=jsonb_build_object('id','archive-completed-'||p_id,'orderId',p_id,'branchId',bid,'spkCode',o.spk_code,'customerName',coalesce(customer,''),'kind','completed','orderExists',true,'occurredAt',o.archive_finalized_at,'actorName',NULL);
  PERFORM public.printex_report_add(p_id,bid,day,'process','DONE',0,0,jsonb_build_object('event',base));
 END IF;
 SELECT min((value->>'at')::timestamptz) FILTER(WHERE value->>'kind'='entered' AND value->>'code' IN ('DESIGN','DESIGN_DONE')),
  min((value->>'at')::timestamptz) FILTER(WHERE value->>'kind'='entered' AND value->>'code'='DONE'),max((value->>'at')::timestamptz)
 INTO started,completed,last_stamp FROM jsonb_array_elements(events);
 is_finished:=completed IS NOT NULL OR (SELECT production_steps.code IN ('DONE','ARCHIVE') FROM public.production_steps WHERE id=o.current_step_id);
 ending:=coalesce(completed,last_stamp);
 FOR e IN SELECT value FROM jsonb_array_elements(events) LOOP
  code:=e->>'code'; kind:=e->>'kind'; stamp:=(e->>'at')::timestamptz;
  -- Flow averages retain all actual visits; returns are not completions.
  IF flow_code IS NOT NULL AND (kind='entered' OR flow_code=code) AND NOT(kind='entered' AND flow_code=code) THEN
   IF kind='completed' OR (kind='entered' AND (SELECT sequence FROM public.production_steps WHERE production_steps.code=e->>'code')>(SELECT sequence FROM public.production_steps WHERE production_steps.code=flow_code)) THEN
    day:=(stamp AT TIME ZONE 'Asia/Jakarta')::date;
    -- Collapse visit sums into one contribution per order/day/stage below.
    INSERT INTO public.report_contributions(order_id,branch_id,report_date,metric,dimension,milliseconds,data)
    VALUES(p_id,bid,day,'flow',flow_code,greatest(extract(epoch FROM stamp-flow_at)*1000,0),jsonb_build_object('visits',1))
    ON CONFLICT(order_id,report_date,metric,dimension) DO UPDATE SET milliseconds=public.report_contributions.milliseconds+excluded.milliseconds,data=jsonb_build_object('visits',(public.report_contributions.data->>'visits')::integer+1);
   END IF;
   flow_code:=NULL;
  END IF;
  IF kind='entered' AND flow_code IS DISTINCT FROM code THEN flow_code:=code; flow_at:=stamp; END IF;
  IF started IS NULL OR stamp<started OR stamp>ending THEN CONTINUE; END IF;
  IF (kind<>'entered' AND open_code=code) OR (kind='entered' AND open_code IS NOT NULL AND open_code IS DISTINCT FROM code) THEN
   ms:=greatest(extract(epoch FROM least(stamp,ending)-open_at)*1000,0);
   durations:=jsonb_set(durations,ARRAY[open_code],to_jsonb(coalesce((durations->>open_code)::numeric,0)+ms));
   exits:=jsonb_set(exits,ARRAY[open_code],to_jsonb(least(stamp,ending))); open_code:=NULL;
  END IF;
  IF kind='entered' AND code IN ('DESIGN','DESIGN_DONE','PRINTING','PRESS') AND open_code IS DISTINCT FROM code THEN
   open_code:=code; open_at:=stamp; visited:=jsonb_set(visited,ARRAY[code],'true');
  END IF;
 END LOOP;
 IF open_code IS NOT NULL AND is_finished THEN
  durations:=jsonb_set(durations,ARRAY[open_code],to_jsonb(coalesce((durations->>open_code)::numeric,0)+greatest(extract(epoch FROM ending-open_at)*1000,0)));
  IF completed IS NOT NULL THEN exits:=jsonb_set(exits,ARRAY[open_code],to_jsonb(completed)); END IF;
 END IF;
 payload:=jsonb_build_object('order',order_data,'productionMilliseconds',CASE WHEN started IS NOT NULL AND completed IS NOT NULL THEN greatest(extract(epoch FROM completed-started)*1000,0) END);
 IF started IS NOT NULL AND completed IS NOT NULL THEN
  day:=(completed AT TIME ZONE 'Asia/Jakarta')::date;
  PERFORM public.printex_report_add(p_id,bid,day,'production','',0,greatest(extract(epoch FROM completed-started)*1000,0),payload);
 END IF;
 FOREACH timing_code IN ARRAY ARRAY['DESIGN','DESIGN_DONE','PRINTING','PRESS'] LOOP
  IF visited ? timing_code AND exits ? timing_code AND NOT(coalesce(NOT is_finished AND open_code=timing_code,false)) THEN
   day:=((exits->>timing_code)::timestamptz AT TIME ZONE 'Asia/Jakarta')::date; ms:=coalesce((durations->>timing_code)::numeric,0);
   PERFORM public.printex_report_add(p_id,bid,day,'timing',timing_code,0,ms,payload);
   IF timing_code IN ('PRINTING','PRESS') THEN
    dim:=CASE WHEN timing_code='PRESS' THEN 'press' WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE 'sublim' END;
    PERFORM public.printex_report_add(p_id,bid,day,'productivity',dim||':'||CASE WHEN upper(trim(o.production_type))='DTF' THEN 'dtf' ELSE coalesce((o.paper_width::float8)::text,'unknown') END,greatest(o.meter,0),ms);
   END IF;
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.printex_refresh_report_queue(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; refreshed integer:=0; BEGIN
 IF NOT pg_try_advisory_xact_lock(73621,1) THEN RETURN -1; END IF;
 FOR r IN SELECT order_id FROM public.report_refresh_queue ORDER BY queued_at,order_id LIMIT least(greatest(p_limit,1),500) FOR UPDATE SKIP LOCKED LOOP
  PERFORM public.printex_refresh_report_order(r.order_id);
  DELETE FROM public.report_refresh_queue WHERE order_id=r.order_id; refreshed:=refreshed+1;
 END LOOP;
 RETURN refreshed;
END $$;

CREATE OR REPLACE FUNCTION public.printex_daily_report(p_start date,p_end date,p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; pending boolean; result jsonb; allowed uuid[]; BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id) INTO allowed FROM public.printex_read_branches() AS id;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 THEN RAISE EXCEPTION 'Rentang laporan tidak valid'; END IF;
 IF pg_try_advisory_xact_lock(73621,1) THEN
 FOR r IN SELECT order_id FROM public.report_refresh_queue WHERE branch_id=ANY(allowed)
  AND (p_branch IS NULL OR branch_id=p_branch) ORDER BY queued_at,order_id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  PERFORM public.printex_refresh_report_order(r.order_id); DELETE FROM public.report_refresh_queue WHERE order_id=r.order_id;
 END LOOP;
 END IF;
 SELECT exists(SELECT 1 FROM public.report_refresh_queue WHERE branch_id=ANY(allowed) AND (p_branch IS NULL OR branch_id=p_branch)) INTO pending;
 SELECT coalesce(jsonb_agg(jsonb_build_object('day',report_date,'branchId',branch_id,'metric',metric,'dimension',dimension,'count',order_count,'meter',meter,'milliseconds',milliseconds) ORDER BY report_date,branch_id,metric,dimension),'[]') INTO result
 FROM public.report_daily_summaries WHERE report_date BETWEEN p_start AND p_end AND order_count>0
 AND branch_id=ANY(allowed) AND (p_branch IS NULL OR branch_id=p_branch);
 RETURN jsonb_build_object('rows',result,'pending',pending,'asOf',now());
END $$;
CREATE OR REPLACE FUNCTION public.printex_report_details(p_start date,p_end date,p_metric text,p_dimension text DEFAULT '',p_branch uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_search text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; total bigint; allowed uuid[]; BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id) INTO allowed FROM public.printex_read_branches() AS id;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 OR p_metric IS NULL OR p_metric NOT IN ('archive','process','timing','production') OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Filter laporan tidak valid'; END IF;
 SELECT count(*) INTO total FROM public.report_contributions WHERE report_date BETWEEN p_start AND p_end AND metric=p_metric AND dimension=p_dimension
 AND branch_id=ANY(allowed) AND (p_branch IS NULL OR branch_id=p_branch) AND (p_search='' OR position(lower(p_search) IN lower(coalesce(data->'order'->>'spk_code',data->'event'->>'spkCode','')||' '||coalesce(data->'order'->'customer'->>'name',data->'event'->>'customerName','')))>0);
 SELECT coalesce(jsonb_agg(t.data),'[]') INTO result FROM (SELECT data||jsonb_build_object('milliseconds',milliseconds,'day',report_date) AS data FROM public.report_contributions
 WHERE report_date BETWEEN p_start AND p_end AND metric=p_metric AND dimension=p_dimension AND branch_id=ANY(allowed)
 AND (p_branch IS NULL OR branch_id=p_branch) AND (p_search='' OR position(lower(p_search) IN lower(coalesce(data->'order'->>'spk_code',data->'event'->>'spkCode','')||' '||coalesce(data->'order'->'customer'->>'name',data->'event'->>'customerName','')))>0)
 ORDER BY report_date DESC,order_id LIMIT least(greatest(p_limit,1),200) OFFSET p_offset) t;
 RETURN jsonb_build_object('items',result,'total',total);
END $$;
REVOKE ALL ON FUNCTION public.printex_report_delta(),public.printex_queue_report(),public.printex_report_add(uuid,uuid,date,text,text,numeric,numeric,jsonb),public.printex_refresh_report_order(uuid),public.printex_refresh_report_queue(integer),public.printex_daily_report(date,date,uuid),public.printex_report_details(date,date,text,text,uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.printex_daily_report(date,date,uuid),public.printex_report_details(date,date,text,text,uuid,integer,integer,text) TO authenticated;
INSERT INTO public.report_refresh_queue(order_id,branch_id) SELECT id,branch_id FROM public.orders o WHERE NOT EXISTS(SELECT 1 FROM public.report_contributions c WHERE c.order_id=o.id AND c.metric='intake') ON CONFLICT DO NOTHING;
-- Include retained reports whose orders were deleted.
INSERT INTO public.report_refresh_queue(order_id,branch_id) SELECT DISTINCT order_identity::uuid,branch_id FROM public.process_history WHERE branch_id IS NOT NULL AND order_identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND NOT EXISTS(SELECT 1 FROM public.report_contributions c WHERE c.order_id=process_history.order_identity::uuid) ON CONFLICT DO NOTHING;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.printex_online_status()'::regprocedure) INTO definition;
 IF position('daily_summaries_enabled' IN definition)=0 THEN EXECUTE replace(definition,'''schema_version'',','''daily_summaries_enabled'',true,''schema_version'','); END IF;
 IF to_regnamespace('cron') IS NOT NULL THEN
  EXECUTE 'SELECT cron.schedule(''printex-daily-report-refresh'',''* * * * *'',''SELECT public.printex_refresh_report_queue(500);'')';
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
