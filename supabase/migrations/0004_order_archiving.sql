-- Archiving keeps the original row/ID and history. Active queries exclude ARCHIVE.
ALTER TABLE public.orders ADD COLUMN archived_at timestamptz;
ALTER TABLE public.orders ADD COLUMN delivery_method text
  CHECK (delivery_method IN ('pickup', 'delivery'));
ALTER TABLE public.orders ADD CONSTRAINT archive_delivery_metadata
  CHECK ((archived_at IS NULL) = (delivery_method IS NULL));
CREATE INDEX orders_archived_at ON public.orders(archived_at) WHERE archived_at IS NOT NULL;

CREATE FUNCTION public.enforce_order_archiving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT code INTO previous_code FROM public.production_steps WHERE id = OLD.current_step_id;
    IF previous_code = 'ARCHIVE' THEN
      RAISE EXCEPTION 'Archived orders are read-only; preserve the order and its reports';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT code INTO next_code FROM public.production_steps WHERE id = NEW.current_step_id;
  IF next_code = 'ARCHIVE' THEN
    IF TG_OP = 'INSERT' OR previous_code IS DISTINCT FROM 'DONE' THEN
      RAISE EXCEPTION 'Only Done orders can be archived';
    END IF;
    IF NEW.delivery_method IS NULL OR NEW.delivery_method NOT IN ('pickup', 'delivery') THEN
      RAISE EXCEPTION 'Confirm pickup or delivery before archiving';
    END IF;
    NEW.archived_at := statement_timestamp();
    NEW.order_state := 'completed';
  ELSIF NEW.archived_at IS NOT NULL OR NEW.delivery_method IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery metadata is only valid for archived orders';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_order_archiving() FROM PUBLIC;
CREATE TRIGGER orders_enforce_archiving BEFORE INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_archiving();
