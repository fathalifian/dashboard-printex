-- One row per transition; retain the destination for accurate timing/revisions.
BEGIN;
ALTER TABLE public.process_history ADD COLUMN IF NOT EXISTS next_step_id uuid REFERENCES public.production_steps(id);
ALTER TABLE public.process_history ADD COLUMN IF NOT EXISTS next_event_id uuid;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_method_check CHECK(delivery_method IN ('pickup','delivery','received'));

CREATE OR REPLACE FUNCTION public.capture_process_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_sequence integer; next_sequence integer; employee_name text; customer text;
BEGIN
 IF current_setting('printex.importing',true)='yes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
 IF NEW.current_step_id IS NULL THEN RAISE EXCEPTION 'An existing production stage cannot be cleared'; END IF;
 SELECT sequence INTO STRICT next_sequence FROM public.production_steps WHERE id=NEW.current_step_id;
 SELECT full_name INTO employee_name FROM public.profiles WHERE id=auth.uid();
 SELECT name INTO customer FROM public.customers WHERE id=NEW.customer_id;
 IF TG_OP='UPDATE' AND OLD.current_step_id IS NOT NULL THEN
  SELECT sequence INTO STRICT previous_sequence FROM public.production_steps WHERE id=OLD.current_step_id;
  INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,actor_id,actor_name,assigned_employee_id,customer_name,next_step_id,next_event_id,occurred_at)
  VALUES(NEW.id,NEW.spk_code,OLD.current_step_id,CASE WHEN next_sequence>previous_sequence THEN 'completed' ELSE 'returned' END,
   auth.uid(),employee_name,OLD.assigned_designer_id,coalesce(customer,''),NEW.current_step_id,gen_random_uuid(),statement_timestamp());
 ELSE
  -- One initial anchor per order, rather than an entry at every stage.
  INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,actor_id,actor_name,assigned_employee_id,customer_name,occurred_at)
  VALUES(NEW.id,NEW.spk_code,NEW.current_step_id,'entered',auth.uid(),employee_name,NEW.assigned_designer_id,coalesce(customer,''),statement_timestamp());
 END IF;
 RETURN NEW;
END $$;

-- Preserve existing archive protections and branch retirement behavior.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.enforce_order_archiving()'::regprocedure) INTO definition;
 definition:=replace(definition,'''pickup'', ''delivery''','''pickup'', ''delivery'', ''received''');
 definition:=replace(definition,'NEW.archived_at := statement_timestamp();',
  'NEW.archived_at := statement_timestamp(); IF NEW.delivery_method = ''received'' THEN NEW.archive_finalized_at := NEW.archived_at; NEW.photo_path := NULL; END IF;');
 EXECUTE definition;
END $$;

-- Add compact metadata to the scoped response without expanding it on the server.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb,uuid,boolean,text[])'::regprocedure) INTO definition;
 IF position('h.next_step_id' IN definition)=0 THEN
  definition:=replace(definition,'h.actor_name,h.customer_name','h.actor_name,h.customer_name,h.next_step_id,h.next_event_id');
  definition:=replace(definition,'''customer_name'''',h.customer_name','''customer_name'''',h.customer_name,''''next_step_id'''',h.next_step_id,''''next_event_id'''',h.next_event_id');
  EXECUTE definition;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
