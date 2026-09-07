-- ARCHIVE is a visible board column until the employee presses Selesai.
-- Existing archives remain pending; do not invent a completion timestamp.
ALTER TABLE public.orders ADD COLUMN archive_finalized_at timestamptz;
ALTER TABLE public.orders ADD CONSTRAINT finalized_requires_archive
  CHECK (archive_finalized_at IS NULL OR archived_at IS NOT NULL);
CREATE INDEX orders_archive_finalized_at ON public.orders(archive_finalized_at)
  WHERE archive_finalized_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_order_archiving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT code INTO previous_code FROM public.production_steps WHERE id = OLD.current_step_id;
    IF previous_code = 'ARCHIVE' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Preserve archived orders and reports';
      END IF;
      IF (to_jsonb(NEW) - 'archive_finalized_at' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(OLD) - 'archive_finalized_at' - 'updated_at') THEN
        RAISE EXCEPTION 'Archived order data is read-only';
      END IF;
      IF OLD.archive_finalized_at IS NOT NULL THEN
        RETURN OLD; -- repeated clicks cannot change the original report date
      END IF;
      IF NEW.archive_finalized_at IS NOT NULL THEN
        IF OLD.archived_at IS NULL OR OLD.delivery_method IS NULL THEN
          RAISE EXCEPTION 'Delivery confirmation is required before finalization';
        END IF;
        NEW.archive_finalized_at := statement_timestamp();
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.archive_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Move to the archive board before finalizing';
  END IF;
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
