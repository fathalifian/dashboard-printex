-- Keep an immutable reporting identity even if the source order is deleted.
ALTER TABLE public.process_history ADD COLUMN order_identity text;
UPDATE public.process_history
SET order_identity = COALESCE(order_id::text, 'legacy-spk:' || spk_code);
ALTER TABLE public.process_history ALTER COLUMN order_identity SET NOT NULL;

CREATE FUNCTION public.set_process_order_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.order_identity := NEW.order_id::text;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_process_order_identity() FROM PUBLIC;
CREATE TRIGGER process_history_set_identity BEFORE INSERT ON public.process_history
FOR EACH ROW EXECUTE FUNCTION public.set_process_order_identity();
CREATE INDEX process_history_identity_step_kind_time
ON public.process_history(order_identity, step_id, event_kind, occurred_at, id);

-- Deduplicate across ALL dates and actors, then filter the resulting milestones.
-- Raw history remains available for auditing revisions and repeated movements.
CREATE VIEW public.process_order_milestones WITH (security_invoker = true) AS
SELECT DISTINCT ON (order_identity, step_id, event_kind)
  id, order_identity, order_id, spk_code, step_id, event_kind,
  occurred_at, actor_id, actor_name, assigned_employee_id
FROM public.process_history
ORDER BY order_identity, step_id, event_kind, occurred_at, id;
GRANT SELECT ON public.process_order_milestones TO authenticated;

CREATE OR REPLACE VIEW public.process_daily_reports WITH (security_invoker = true) AS
SELECT (occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS report_date,
  step_id, actor_id, actor_name,
  count(*) FILTER (WHERE event_kind = 'entered') AS entered_count,
  count(*) FILTER (WHERE event_kind = 'completed') AS completed_count,
  count(*) FILTER (WHERE event_kind = 'returned') AS returned_count
FROM public.process_order_milestones
GROUP BY 1, 2, 3, 4;
