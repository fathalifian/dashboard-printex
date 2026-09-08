BEGIN;
-- Apply after 0001..0006. No existing order/history is deleted.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS legacy_id text UNIQUE;
ALTER TABLE public.process_history ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT '';
ALTER TABLE public.process_history ADD COLUMN IF NOT EXISTS legacy_event_id text UNIQUE;

CREATE OR REPLACE FUNCTION public.printex_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active);
$$;
CREATE OR REPLACE FUNCTION public.printex_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active AND role IN ('superadmin','admin'));
$$;
REVOKE ALL ON FUNCTION public.printex_staff(), public.printex_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_staff(), public.printex_admin() TO authenticated;

-- Block anonymous access and direct writes; mutations go through checked RPCs.
DO $$ DECLARE t text; p record; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','customers','production_steps','orders','process_history','machines','order_step_events','order_activities','production_schedules','schedule_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    IF t = 'profiles' THEN
      EXECUTE 'CREATE POLICY online_read ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.printex_admin())';
    ELSE
      EXECUTE format('CREATE POLICY online_read ON public.%I FOR SELECT TO authenticated USING (public.printex_staff())', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.production_steps(code,name,sequence,color_token) VALUES
('ORDER_IN','Order Masuk',1,'slate'),('DESIGN','Proses Design',2,'red'),
('DESIGN_DONE','Design Done',3,'blue'),('PRINTING','Proses Cetak',4,'amber'),
('DONE','Done',5,'emerald'),('ARCHIVE','Arsip',6,'slate') ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.printex_order_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE step_code text;
BEGIN
  IF current_setting('printex.importing',true) = 'yes' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO NEW.current_step_id FROM public.production_steps WHERE code='ORDER_IN';
  END IF;
  SELECT code INTO STRICT step_code FROM public.production_steps WHERE id=NEW.current_step_id;
  NEW.order_state := CASE WHEN step_code IN ('DONE','ARCHIVE') THEN 'completed' ELSE 'active' END;
  NEW.updated_at := statement_timestamp();
  IF TG_OP = 'UPDATE' THEN NEW.version := OLD.version + 1; END IF;
  IF step_code = 'DONE' AND NEW.completed_at IS NULL THEN NEW.completed_at := statement_timestamp(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_00_defaults ON public.orders;
CREATE TRIGGER orders_00_defaults BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.printex_order_defaults();

CREATE SEQUENCE IF NOT EXISTS public.printex_spk_seq START 1100;
SELECT setval('public.printex_spk_seq', GREATEST(1100, (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM public.printex_spk_seq), COALESCE((SELECT max(substring(spk_code FROM '^SPK-([0-9]+)$')::bigint)+1 FROM public.orders),1100)), false);

CREATE OR REPLACE FUNCTION public.printex_mutate_order(p_action text, p_order_id uuid, p_expected_version bigint, p_data jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.orders; customer_uuid uuid; stage_uuid uuid; result_id uuid;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('create','edit','move','delete','archive','finish') THEN RAISE EXCEPTION 'Aksi tidak valid'; END IF;
  IF p_action IN ('create','edit') THEN
    IF nullif(trim(p_data->>'customerName'),'') IS NULL OR length(p_data->>'customerName') > 200
       OR (p_data->>'productionType') NOT IN ('Sublim','DTF','Umbul-umbul','Batik','Jersey')
       OR p_data->>'productionType' IS NULL OR (p_data->>'meter')::numeric < 0
       OR (p_data->>'meter') IS NULL OR (p_data->>'customerType') NOT IN ('regular','priority')
       OR p_data->>'customerType' IS NULL OR nullif(p_data->>'orderDate','') IS NULL OR nullif(p_data->>'dueDate','') IS NULL THEN
      RAISE EXCEPTION 'Data order tidak lengkap atau tidak valid';
    END IF;
  END IF;
  IF p_action = 'create' THEN
    -- Client-generated UUID makes retry after a lost response idempotent.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id) THEN RETURN p_order_id; END IF;
    INSERT INTO public.customers(name) VALUES(trim(p_data->>'customerName')) RETURNING id INTO customer_uuid;
    INSERT INTO public.orders(id,spk_code,customer_id,production_type,meter,customer_type,order_date,due_at,notes,created_by)
    VALUES(p_order_id,'SPK-'||nextval('public.printex_spk_seq'),customer_uuid,p_data->>'productionType',
      (p_data->>'meter')::numeric,p_data->>'customerType',(p_data->>'orderDate')::date,(p_data->>'dueDate')::date,
      COALESCE(p_data->>'notes',''),auth.uid()) RETURNING id INTO result_id;
    RETURN result_id;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order sudah dihapus atau tidak ditemukan'; END IF;
  IF p_action='finish' AND o.archive_finalized_at IS NOT NULL THEN RETURN o.id; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001'; END IF;
  CASE p_action
  WHEN 'edit' THEN
    IF nullif(trim(p_data->>'spkCode'),'') IS NULL THEN RAISE EXCEPTION 'Kode SPK wajib diisi'; END IF;
    UPDATE public.customers SET name=trim(p_data->>'customerName'),updated_at=statement_timestamp() WHERE id=o.customer_id;
    UPDATE public.orders SET spk_code=trim(p_data->>'spkCode'),production_type=p_data->>'productionType',meter=(p_data->>'meter')::numeric,
      customer_type=p_data->>'customerType',order_date=(p_data->>'orderDate')::date,due_at=(p_data->>'dueDate')::date,notes=COALESCE(p_data->>'notes','') WHERE id=o.id;
  WHEN 'move' THEN
    IF p_data->>'code' = 'ARCHIVE' THEN RAISE EXCEPTION 'Konfirmasi penyerahan sebelum arsip'; END IF;
    SELECT id INTO STRICT stage_uuid FROM public.production_steps WHERE code=p_data->>'code';
    UPDATE public.orders SET current_step_id=stage_uuid WHERE id=o.id;
  WHEN 'archive' THEN
    SELECT id INTO STRICT stage_uuid FROM public.production_steps WHERE code='ARCHIVE';
    UPDATE public.orders SET current_step_id=stage_uuid,delivery_method=p_data->>'deliveryMethod' WHERE id=o.id;
  WHEN 'finish' THEN
    UPDATE public.orders SET archive_finalized_at=statement_timestamp() WHERE id=o.id;
  WHEN 'delete' THEN
    DELETE FROM public.orders WHERE id=o.id;
  END CASE;
  RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION public.printex_mutate_order(text,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_mutate_order(text,uuid,bigint,jsonb) TO authenticated;

-- New signups never receive staff access automatically.
CREATE OR REPLACE FUNCTION public.printex_new_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id,full_name,role,is_active)
  VALUES(NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.email,'Karyawan'),'staff',false)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS printex_auth_profile ON auth.users;
CREATE TRIGGER printex_auth_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.printex_new_profile();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['orders','customers','production_steps','process_history','profiles'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.printex_online_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif. Hubungi admin.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('schema_version',7,'realtime_tables',
    (SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;
REVOKE ALL ON FUNCTION public.printex_online_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_online_status() TO authenticated;
CREATE OR REPLACE FUNCTION public.capture_process_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous_sequence integer;
  next_sequence integer;
  employee_name text;
  event_time timestamptz := statement_timestamp();
BEGIN
  IF current_setting('printex.importing',true) = 'yes' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  END IF;
  -- Clearing a stage is not a completion and must not erase tracking.
  IF NEW.current_step_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.current_step_id IS NOT NULL THEN
      RAISE EXCEPTION 'An existing production stage cannot be cleared';
    END IF;
    UPDATE public.process_history SET customer_name = COALESCE((SELECT name FROM public.customers WHERE id=NEW.customer_id),'') WHERE order_id=NEW.id AND occurred_at=event_time;
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
  UPDATE public.process_history SET customer_name = COALESCE((SELECT name FROM public.customers WHERE id=NEW.customer_id),'') WHERE order_id=NEW.id AND occurred_at=event_time;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_order_archiving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text;
BEGIN
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
CREATE OR REPLACE FUNCTION public.enforce_adjacent_order_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE stage_ids uuid[]; previous_position integer; next_position integer;
BEGIN
  IF current_setting('printex.importing',true) = 'yes' THEN RETURN NEW; END IF;
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
COMMIT;

-- Retire the old browser-import endpoint without deleting existing online data.
BEGIN;
DROP FUNCTION IF EXISTS public.printex_import_local(jsonb);
COMMIT;
