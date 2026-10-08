-- Store the report snapshot once per order. RPC JSON remains compatible.
BEGIN;
CREATE TABLE IF NOT EXISTS public.report_order_payloads (
 order_id uuid PRIMARY KEY,
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 data jsonb NOT NULL
);
ALTER TABLE public.report_order_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_order_payloads FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT order_id FROM public.report_contributions
  WHERE data ? 'order' AND data->'order'<>'null'::jsonb
  GROUP BY order_id HAVING count(DISTINCT data->'order')>1) THEN
  RAISE EXCEPTION 'Conflicting report snapshots: refusing to merge';
 END IF;
END $$;
INSERT INTO public.report_order_payloads(order_id,branch_id,data)
SELECT DISTINCT ON(order_id) order_id,branch_id,data->'order'
FROM public.report_contributions WHERE data ? 'order' AND data->'order'<>'null'::jsonb
ORDER BY order_id
ON CONFLICT(order_id) DO UPDATE SET branch_id=excluded.branch_id,data=excluded.data;

CREATE OR REPLACE FUNCTION public.printex_compact_report_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.data ? 'order' AND NEW.data->'order'<>'null'::jsonb THEN
  INSERT INTO public.report_order_payloads(order_id,branch_id,data)
  VALUES(NEW.order_id,NEW.branch_id,NEW.data->'order')
  ON CONFLICT(order_id) DO UPDATE SET branch_id=excluded.branch_id,data=excluded.data
  WHERE (public.report_order_payloads.branch_id,public.report_order_payloads.data)
   IS DISTINCT FROM (excluded.branch_id,excluded.data);
  NEW.data:=jsonb_set(NEW.data,'{order}','null'::jsonb);
 END IF;
 IF NEW.data ? 'event' THEN
  NEW.data:=jsonb_set(NEW.data,'{event,actorName}','null'::jsonb);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.printex_compact_report_payload() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS report_compact_payload ON public.report_contributions;
CREATE TRIGGER report_compact_payload BEFORE INSERT OR UPDATE ON public.report_contributions
FOR EACH ROW EXECUTE FUNCTION public.printex_compact_report_payload();

-- Payload-only changes cannot affect aggregate values. Avoid delta churn.
ALTER TABLE public.report_contributions DISABLE TRIGGER report_contribution_delta;
UPDATE public.report_contributions SET data=CASE WHEN data ? 'order'
 THEN jsonb_set(data,'{order}','null'::jsonb) ELSE data END
WHERE (data ? 'order' AND data->'order'<>'null'::jsonb)
 OR (data ? 'event' AND data->'event'->'actorName' IS DISTINCT FROM 'null'::jsonb);
ALTER TABLE public.report_contributions ENABLE TRIGGER report_contribution_delta;

CREATE OR REPLACE VIEW public.printex_report_expanded AS
SELECT c.order_id,c.branch_id,c.report_date,c.metric,c.dimension,c.meter,c.milliseconds,
 CASE WHEN c.data ? 'order' AND p.order_id IS NOT NULL THEN jsonb_set(c.data,'{order}',p.data) ELSE c.data END AS data
FROM public.report_contributions c LEFT JOIN public.report_order_payloads p ON p.order_id=c.order_id AND p.branch_id=c.branch_id;
REVOKE ALL ON public.printex_report_expanded FROM PUBLIC,anon,authenticated;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.printex_report_details(date,date,text,text,uuid,integer,integer,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'FROM public.report_contributions','FROM public.printex_report_expanded');
 EXECUTE definition;
  SELECT pg_get_functiondef('public.printex_refresh_report_order(uuid)'::regprocedure) INTO definition;
  definition:=replace(definition,'''actor'',h.actor_name','''actor'',NULL');
 IF position('DELETE FROM public.report_order_payloads WHERE order_id=p_id;' IN definition)=0 THEN
  definition:=replace(definition,'DELETE FROM public.report_contributions WHERE order_id=p_id;',
   'DELETE FROM public.report_contributions WHERE order_id=p_id; DELETE FROM public.report_order_payloads WHERE order_id=p_id;');
 END IF;
  EXECUTE definition;
END $$;
DELETE FROM public.report_order_payloads p WHERE NOT EXISTS(
 SELECT 1 FROM public.report_contributions c WHERE c.order_id=p.order_id AND c.data ? 'order'
);
NOTIFY pgrst,'reload schema';
COMMIT;
