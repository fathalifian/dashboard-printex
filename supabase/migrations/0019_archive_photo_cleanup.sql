-- Requires 0015 and 0016. Applies to orders finalized after this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_order_archiving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text;
BEGIN
  -- Only FK-triggered removal of user references may update finalized archives.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    IF (to_jsonb(NEW) - 'created_by' - 'assigned_designer_id' - 'updated_at' - 'version')
      = (to_jsonb(OLD) - 'created_by' - 'assigned_designer_id' - 'updated_at' - 'version')
      AND (NEW.created_by IS NULL OR NEW.created_by IS NOT DISTINCT FROM OLD.created_by)
      AND (NEW.assigned_designer_id IS NULL OR NEW.assigned_designer_id IS NOT DISTINCT FROM OLD.assigned_designer_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF current_setting('printex.importing',true) = 'yes' THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT code INTO previous_code FROM public.production_steps WHERE id = OLD.current_step_id;
    IF previous_code = 'ARCHIVE' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Preserve archived orders and reports';
      END IF;
      IF (to_jsonb(NEW) - 'archive_finalized_at' - 'updated_at' - 'version')
         IS DISTINCT FROM (to_jsonb(OLD) - 'archive_finalized_at' - 'updated_at' - 'version') THEN
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
        NEW.photo_path := NULL; -- Release the photo only when leaving the board for reports.
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

-- UPDATE OF photo_path would miss a path cleared inside a BEFORE trigger.
DROP TRIGGER IF EXISTS orders_queue_old_photo ON public.orders;
CREATE TRIGGER orders_queue_old_photo AFTER DELETE OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.printex_queue_old_photo();
COMMIT;
