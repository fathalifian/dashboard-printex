BEGIN;
-- Retain business records when an Auth user cascades deletion to its profile.
DO $$ DECLARE fk record; BEGIN
  FOR fk IN
    SELECT c.conname,c.conrelid::regclass AS tbl,a.attname
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND c.confrelid='public.profiles'::regclass AND n.nspname='public' AND array_length(c.conkey,1)=1
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',fk.tbl,fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE SET NULL',fk.tbl,fk.conname,fk.attname);
  END LOOP;
END $$;
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
CREATE OR REPLACE FUNCTION public.printex_list_users() RETURNS TABLE(id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.role='superadmin') THEN
    RAISE EXCEPTION 'Hanya Super Admin yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active
    FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE (u.deleted_at IS NULL OR p.deletion_requested_at IS NOT NULL) ORDER BY p.created_at,p.id;
END $$;
REVOKE ALL ON FUNCTION public.printex_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_list_users() TO authenticated;


COMMIT;
