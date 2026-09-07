-- Durable process history. Apply after 0001_initial_schema.sql.
-- No historical backfill: a current status cannot establish when work was finished.
CREATE TABLE public.process_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  spk_code text NOT NULL,
  step_id uuid NOT NULL REFERENCES public.production_steps(id),
  event_kind text NOT NULL CHECK (event_kind IN ('entered', 'completed', 'returned')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text,
  assigned_employee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX process_history_step_time ON public.process_history(step_id, occurred_at);
CREATE INDEX process_history_actor_time ON public.process_history(actor_id, occurred_at);
CREATE INDEX process_history_order_time ON public.process_history(order_id, occurred_at);
ALTER TABLE public.process_history ENABLE ROW LEVEL SECURITY;

-- Authenticated active staff can read reports. Clients cannot forge/edit history.
CREATE POLICY "Active staff read process history" ON public.process_history
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active)
);
REVOKE ALL ON public.process_history FROM anon, authenticated;
GRANT SELECT ON public.process_history TO authenticated;

CREATE FUNCTION public.capture_process_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous_sequence integer;
  next_sequence integer;
  employee_name text;
  event_time timestamptz := statement_timestamp();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  END IF;
  -- Clearing a stage is not a completion and must not erase tracking.
  IF NEW.current_step_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.current_step_id IS NOT NULL THEN
      RAISE EXCEPTION 'An existing production stage cannot be cleared';
    END IF;
    RETURN NEW;
  END IF;
  SELECT sequence INTO STRICT next_sequence FROM public.production_steps WHERE id = NEW.current_step_id;
  SELECT full_name INTO employee_name FROM public.profiles WHERE id = auth.uid();
  IF TG_OP = 'UPDATE' AND OLD.current_step_id IS NOT NULL THEN
    SELECT sequence INTO STRICT previous_sequence FROM public.production_steps WHERE id = OLD.current_step_id;
    INSERT INTO public.process_history (order_id, spk_code, step_id, event_kind, occurred_at, actor_id, actor_name, assigned_employee_id)
    VALUES (NEW.id, NEW.spk_code, OLD.current_step_id,
      CASE WHEN next_sequence > previous_sequence THEN 'completed' ELSE 'returned' END,
      event_time, auth.uid(), employee_name, OLD.assigned_designer_id);
  END IF;
  INSERT INTO public.process_history (order_id, spk_code, step_id, event_kind, occurred_at, actor_id, actor_name, assigned_employee_id)
  VALUES (NEW.id, NEW.spk_code, NEW.current_step_id, 'entered', event_time, auth.uid(), employee_name, NEW.assigned_designer_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_process_history() FROM PUBLIC;
CREATE TRIGGER orders_capture_process_history
AFTER INSERT OR UPDATE OF current_step_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.capture_process_history();

-- Invoker security preserves the source table's RLS when querying aggregates.
CREATE VIEW public.process_daily_reports WITH (security_invoker = true) AS
SELECT (occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS report_date,
  step_id, actor_id, actor_name,
  count(*) FILTER (WHERE event_kind = 'entered') AS entered_count,
  count(*) FILTER (WHERE event_kind = 'completed') AS completed_count,
  count(*) FILTER (WHERE event_kind = 'returned') AS returned_count
FROM public.process_history
GROUP BY 1, 2, 3, 4;
GRANT SELECT ON public.process_daily_reports TO authenticated;
