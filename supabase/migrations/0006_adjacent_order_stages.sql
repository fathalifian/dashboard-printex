-- Enforce the same adjacent-only transitions at the database boundary.
CREATE FUNCTION public.enforce_adjacent_order_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE stage_ids uuid[]; previous_position integer; next_position integer;
BEGIN
  IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  SELECT array_agg(id ORDER BY sequence, id) INTO stage_ids FROM public.production_steps;
  previous_position := array_position(stage_ids, OLD.current_step_id);
  next_position := array_position(stage_ids, NEW.current_step_id);
  IF previous_position IS NULL OR next_position IS NULL
     OR abs(next_position - previous_position) <> 1 THEN
    RAISE EXCEPTION 'Orders can only move to the immediately previous or next production stage';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_adjacent_order_stage() FROM PUBLIC;
CREATE TRIGGER orders_adjacent_stage BEFORE UPDATE OF current_step_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_adjacent_order_stage();
