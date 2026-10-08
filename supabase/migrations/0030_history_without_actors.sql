-- Preserve the history API shape; do not store the person performing a move.
BEGIN;
CREATE OR REPLACE FUNCTION public.capture_process_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_sequence integer; next_sequence integer; customer text;
BEGIN
 IF current_setting('printex.importing',true)='yes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
 IF NEW.current_step_id IS NULL THEN RAISE EXCEPTION 'An existing production stage cannot be cleared'; END IF;
 SELECT sequence INTO STRICT next_sequence FROM public.production_steps WHERE id=NEW.current_step_id;
 SELECT name INTO customer FROM public.customers WHERE id=NEW.customer_id;
 IF TG_OP='UPDATE' AND OLD.current_step_id IS NOT NULL THEN
  SELECT sequence INTO STRICT previous_sequence FROM public.production_steps WHERE id=OLD.current_step_id;
  INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,customer_name,next_step_id,next_event_id,occurred_at)
  VALUES(NEW.id,NEW.spk_code,OLD.current_step_id,CASE WHEN next_sequence>previous_sequence THEN 'completed' ELSE 'returned' END,
   coalesce(customer,''),NEW.current_step_id,gen_random_uuid(),statement_timestamp());
 ELSE
  INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,customer_name,occurred_at)
  VALUES(NEW.id,NEW.spk_code,NEW.current_step_id,'entered',coalesce(customer,''),statement_timestamp());
 END IF;
 RETURN NEW;
END $$;

-- Imports also pass through this guard. Compatibility columns stay NULL.
CREATE OR REPLACE FUNCTION public.printex_history_no_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.actor_id:=NULL; NEW.actor_name:=NULL; NEW.assigned_employee_id:=NULL;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.printex_history_no_actor() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS history_no_actor ON public.process_history;
CREATE TRIGGER history_no_actor BEFORE INSERT OR UPDATE ON public.process_history
FOR EACH ROW EXECUTE FUNCTION public.printex_history_no_actor();
UPDATE public.process_history SET actor_id=NULL,actor_name=NULL,assigned_employee_id=NULL
WHERE actor_id IS NOT NULL OR actor_name IS NOT NULL OR assigned_employee_id IS NOT NULL;
DROP INDEX IF EXISTS public.process_history_actor_time;
NOTIFY pgrst,'reload schema';
COMMIT;
