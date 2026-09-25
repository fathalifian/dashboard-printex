-- Online setup for existing schemas (0001 through 0006). Safe to rerun.
BEGIN;

-- 0007_online_realtime.sql

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



-- 0008_import_local_data.sql
-- Reserved migration number. Browser import has been retired.
-- Existing installations remove the old endpoint through migration 0009.


-- 0009_remove_local_import.sql
-- Retire the old browser-import endpoint without deleting existing online data.

DROP FUNCTION IF EXISTS public.printex_import_local(jsonb);



-- 0010_seven_stage_workflow.sql
-- Preserve existing stage IDs and historical events; no synthetic Press events.

UPDATE public.production_steps SET name=CASE code
  WHEN 'ORDER_IN' THEN 'Order Masuk' WHEN 'DESIGN' THEN 'Proses Desain'
  WHEN 'DESIGN_DONE' THEN 'Menunggu Pembayaran' WHEN 'PRINTING' THEN 'Proses Sublim'
  WHEN 'DONE' THEN 'Order Selesai' WHEN 'ARCHIVE' THEN 'Order Diterima Customer' END,
  sequence=CASE code WHEN 'ORDER_IN' THEN 1 WHEN 'DESIGN' THEN 2
  WHEN 'DESIGN_DONE' THEN 3 WHEN 'PRINTING' THEN 4 WHEN 'DONE' THEN 6 WHEN 'ARCHIVE' THEN 7 END
WHERE code IN ('ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','DONE','ARCHIVE');
INSERT INTO public.production_steps(code,name,sequence,color_token)
VALUES('PRESS','Proses Press',5,'violet')
ON CONFLICT(code) DO UPDATE SET name=excluded.name,sequence=excluded.sequence,color_token=excluded.color_token;

CREATE OR REPLACE FUNCTION public.enforce_adjacent_order_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text; previous_position integer; next_position integer;
BEGIN
  IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  SELECT code,sequence INTO previous_code,previous_position FROM public.production_steps WHERE id=OLD.current_step_id;
  SELECT code,sequence INTO next_code,next_position FROM public.production_steps WHERE id=NEW.current_step_id;
  IF previous_code='ORDER_IN' AND next_code='DESIGN_DONE' THEN RETURN NEW; END IF;
  IF previous_code='PRINTING' AND next_code='DONE' AND NEW.production_type='DTF' THEN RETURN NEW; END IF;
  IF previous_position IS NULL OR next_position IS NULL OR abs(next_position-previous_position)<>1 THEN
    RAISE EXCEPTION 'Orders can only move to the previous or next stage, skip design, or skip Press for DTF';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_adjacent_order_stage() FROM PUBLIC;



-- 0011_user_management.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
CREATE OR REPLACE FUNCTION public.printex_list_users() RETURNS TABLE(id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.role='superadmin') THEN
    RAISE EXCEPTION 'Hanya Super Admin yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active
    FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE u.deleted_at IS NULL ORDER BY p.created_at,p.id;
END $$;
REVOKE ALL ON FUNCTION public.printex_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.printex_manage_user(p_id uuid,p_name text,p_role text,p_active boolean,p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.profiles;
BEGIN
  -- Serialize role changes so concurrent removals cannot remove the last Super Admin.
  PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='superadmin') THEN
    RAISE EXCEPTION 'Hanya Super Admin yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
  IF p_id=auth.uid() AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'superadmin') THEN
    RAISE EXCEPTION 'Tidak dapat menghapus, menonaktifkan, atau menurunkan role akun sendiri';
  END IF;
  IF target.role='superadmin' AND target.is_active AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'superadmin')
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='superadmin' AND is_active AND id<>p_id) THEN
    RAISE EXCEPTION 'Minimal satu Super Admin aktif harus tersedia';
  END IF;
  IF p_delete THEN
    UPDATE public.profiles SET is_active=false,deletion_requested_at=now(),updated_at=now() WHERE id=p_id;
  ELSE
    IF target.deletion_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Penghapusan akun sedang diproses. Selesaikan penghapusan terlebih dahulu'; END IF;
    IF nullif(trim(p_name),'') IS NULL OR length(p_name)>100 OR p_role IS NULL OR p_role NOT IN ('superadmin','admin','staff') OR p_active IS NULL THEN
      RAISE EXCEPTION 'Nama, role, atau status akun tidak valid';
    END IF;
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Akun sudah dihapus'; END IF;
    UPDATE public.profiles SET full_name=trim(p_name),role=p_role,is_active=p_active,updated_at=now() WHERE id=p_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.printex_manage_user(uuid,text,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_manage_user(uuid,text,text,boolean,boolean) TO authenticated;



-- 0012_hard_delete_users.sql

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





-- 0013_owner_operator_permissions.sql
-- Rename existing accounts in place and enforce Operator permissions in the database.
-- Run once after migration 0012; safe to run again. No orders or history are rewritten.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE public.profiles SET role=CASE role WHEN 'superadmin' THEN 'owner' WHEN 'staff' THEN 'operator' ELSE role END
WHERE role IN ('superadmin','staff');
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('owner','admin','operator'));

CREATE OR REPLACE FUNCTION public.printex_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin','operator'));
$$;
CREATE OR REPLACE FUNCTION public.printex_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active AND role IN ('owner','admin'));
$$;
CREATE OR REPLACE FUNCTION public.printex_mutate_order(p_action text, p_order_id uuid, p_expected_version bigint, p_data jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.orders; customer_uuid uuid; stage_uuid uuid; result_id uuid; actor_role text; source_code text;
BEGIN
  -- Lock the authenticated profile until commit, including against concurrent role changes.
  SELECT p.role INTO actor_role FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','edit','move','delete','archive','finish') THEN RAISE EXCEPTION 'Aksi tidak valid'; END IF;
  IF actor_role='operator' AND p_action<>'move' THEN
    RAISE EXCEPTION 'Operator tidak dapat menambah, mengedit, menghapus, atau mengarsipkan order' USING ERRCODE='42501';
  END IF;
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
  IF actor_role='operator' THEN
    SELECT code INTO source_code FROM public.production_steps WHERE id=o.current_step_id;
    IF source_code IS NULL OR source_code NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE')
      OR COALESCE(p_data->>'code','') NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE') THEN
      RAISE EXCEPTION 'Operator hanya dapat memindahkan order antara Menunggu Pembayaran, Sublim, Press, dan Order Selesai' USING ERRCODE='42501';
    END IF;
  END IF;
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
CREATE OR REPLACE FUNCTION public.printex_new_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id,full_name,role,is_active)
  VALUES(NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.email,'Karyawan'),'operator',false)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.printex_manage_user(p_id uuid,p_name text,p_role text,p_active boolean,p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.profiles;
BEGIN
  -- Serialize role changes so concurrent removals cannot remove the last Owner.
  PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='owner') THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
  IF p_id=auth.uid() AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'owner') THEN
    RAISE EXCEPTION 'Tidak dapat menghapus, menonaktifkan, atau menurunkan role akun sendiri';
  END IF;
  IF target.role='owner' AND target.is_active AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'owner')
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='owner' AND is_active AND id<>p_id) THEN
    RAISE EXCEPTION 'Minimal satu Owner aktif harus tersedia';
  END IF;
  IF p_delete THEN
    UPDATE public.profiles SET is_active=false,deletion_requested_at=now(),updated_at=now() WHERE id=p_id;
  ELSE
    IF target.deletion_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Penghapusan akun sedang diproses. Selesaikan penghapusan terlebih dahulu'; END IF;
    IF nullif(trim(p_name),'') IS NULL OR length(p_name)>100 OR p_role IS NULL OR p_role NOT IN ('owner','admin','operator') OR p_active IS NULL THEN
      RAISE EXCEPTION 'Nama, role, atau status akun tidak valid';
    END IF;
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Akun sudah dihapus'; END IF;
    UPDATE public.profiles SET full_name=trim(p_name),role=p_role,is_active=p_active,updated_at=now() WHERE id=p_id;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.printex_list_users() RETURNS TABLE(id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.role='owner') THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active
    FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE (u.deleted_at IS NULL OR p.deletion_requested_at IS NOT NULL) ORDER BY p.created_at,p.id;
END $$;
CREATE OR REPLACE FUNCTION public.printex_online_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif. Hubungi admin.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('schema_version',8,'realtime_tables',
    (SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;

REVOKE ALL ON FUNCTION public.printex_staff(), public.printex_admin(), public.printex_new_profile(),
  public.printex_mutate_order(text,uuid,bigint,jsonb), public.printex_manage_user(uuid,text,text,boolean,boolean),
  public.printex_list_users(), public.printex_online_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.printex_staff(), public.printex_admin(),
  public.printex_mutate_order(text,uuid,bigint,jsonb), public.printex_manage_user(uuid,text,text,boolean,boolean),
  public.printex_list_users(), public.printex_online_status() TO authenticated;


COMMIT;


-- Customer Service WhatsApp settings (0014)
-- Shared WhatsApp contact. Requires migration 0013. Safe to run again.
BEGIN;
CREATE TABLE IF NOT EXISTS public.customer_service_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  whatsapp_number text NOT NULL DEFAULT ''
    CHECK (whatsapp_number = '' OR whatsapp_number ~ '^[1-9][0-9]{7,14}$')
);
INSERT INTO public.customer_service_settings(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.customer_service_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_service_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_service_settings TO authenticated;
GRANT UPDATE (whatsapp_number) ON public.customer_service_settings TO authenticated;

DROP POLICY IF EXISTS customer_service_read ON public.customer_service_settings;
CREATE POLICY customer_service_read ON public.customer_service_settings
FOR SELECT TO authenticated USING (public.printex_staff());
DROP POLICY IF EXISTS customer_service_update ON public.customer_service_settings;
CREATE POLICY customer_service_update ON public.customer_service_settings
FOR UPDATE TO authenticated USING (public.printex_admin()) WITH CHECK (public.printex_admin());
COMMIT;

-- Optional private order photos. Requires migration 0013 and Supabase Storage.
BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('order-photos','order-photos',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS order_photos_read ON storage.objects;
CREATE POLICY order_photos_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='order-photos' AND public.printex_staff());
DROP POLICY IF EXISTS order_photos_upload ON storage.objects;
CREATE POLICY order_photos_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='order-photos' AND public.printex_admin()
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id::text=split_part(name,'/',1) AND o.archived_at IS NULL));
-- Images use new unique paths, never overwrite an image referenced by an order.
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='order-photos' AND public.printex_admin()
  AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=storage.objects.name));

CREATE OR REPLACE FUNCTION public.printex_set_order_photo(p_order_id uuid,p_expected_version bigint,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF o.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Foto order arsip tidak dapat diubah'; END IF;
  IF o.photo_path IS NOT DISTINCT FROM p_path THEN RETURN; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ ('^'||p_order_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
      RAISE EXCEPTION 'Lokasi foto tidak valid';
    END IF;
    -- Lock against cleanup while linking the uploaded object to the order.
    PERFORM 1 FROM storage.objects WHERE bucket_id='order-photos' AND name=p_path FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Foto belum diunggah'; END IF;
  END IF;
  UPDATE public.orders SET photo_path=p_path WHERE id=p_order_id;
END $$;
REVOKE ALL ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) TO authenticated;
COMMIT;

-- Safe, retryable cleanup. Actual file deletion always uses the Storage API.
BEGIN;
CREATE TABLE IF NOT EXISTS public.order_photo_cleanup (
  path text PRIMARY KEY,
  claimed boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_photo_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_photo_cleanup FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS orders_photo_path_idx ON public.orders(photo_path) WHERE photo_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.printex_queue_old_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.photo_path IS NOT NULL AND (TG_OP='DELETE' OR OLD.photo_path IS DISTINCT FROM NEW.photo_path) THEN
    INSERT INTO public.order_photo_cleanup(path) VALUES(OLD.photo_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS orders_queue_old_photo ON public.orders;
CREATE TRIGGER orders_queue_old_photo AFTER DELETE OR UPDATE OF photo_path ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.printex_queue_old_photo();

CREATE OR REPLACE FUNCTION public.printex_claim_photo_cleanup(p_path text DEFAULT NULL)
RETURNS TABLE(path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat membersihkan foto' USING ERRCODE='42501'; END IF;
  -- A missing object after a successful API deletion needs no remaining queue row.
  DELETE FROM public.order_photo_cleanup q WHERE q.queued_at < now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=q.path);
  FOR candidate IN
    SELECT s.name FROM storage.objects s
    WHERE s.bucket_id='order-photos'
      AND (CASE WHEN p_path IS NOT NULL THEN s.name=p_path ELSE
        s.created_at < now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=s.name) END)
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=s.name)
    ORDER BY s.created_at,s.name LIMIT 50
  LOOP
    -- The photo-link RPC takes the same lock. After this claim it cannot attach the path.
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate,16));
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=candidate) THEN
      INSERT INTO public.order_photo_cleanup AS q(path,claimed) VALUES(candidate,true)
        ON CONFLICT ON CONSTRAINT order_photo_cleanup_pkey DO UPDATE SET claimed=true;
      path:=candidate; RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.printex_claim_photo_cleanup(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_claim_photo_cleanup(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.printex_photo_deletable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.printex_admin()
    AND EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=p_path AND q.claimed)
    AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=p_path);
$$;
REVOKE ALL ON FUNCTION public.printex_photo_deletable(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_photo_deletable(text) TO authenticated;
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='order-photos' AND public.printex_photo_deletable(name));

CREATE OR REPLACE FUNCTION public.printex_set_order_photo(p_order_id uuid,p_expected_version bigint,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  IF p_path IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_path,16));
    IF EXISTS(SELECT 1 FROM public.order_photo_cleanup WHERE path=p_path AND claimed) THEN
      RAISE EXCEPTION 'Foto sudah dijadwalkan untuk dibersihkan. Unggah ulang foto.';
    END IF;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF o.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Foto order arsip tidak dapat diubah'; END IF;
  IF o.photo_path IS NOT DISTINCT FROM p_path THEN RETURN; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ ('^'||p_order_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN RAISE EXCEPTION 'Lokasi foto tidak valid'; END IF;
    PERFORM 1 FROM storage.objects WHERE bucket_id='order-photos' AND name=p_path FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Foto belum diunggah'; END IF;
  END IF;
  UPDATE public.orders SET photo_path=p_path WHERE id=p_order_id;
  DELETE FROM public.order_photo_cleanup WHERE path=p_path AND NOT claimed;
END $$;
REVOKE ALL ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_set_order_photo(uuid,bigint,text) TO authenticated;
COMMIT;

-- Shared production board shortcuts. Only the exact Admin role may edit.
BEGIN;
CREATE TABLE IF NOT EXISTS public.stock_shortcuts (
  id text PRIMARY KEY CHECK (id IN ('dtf_paper','fabric')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  url text NOT NULL CHECK (length(url)<=2048 AND url ~ '^https://[^[:space:]]+$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0)
);
INSERT INTO public.stock_shortcuts(id,label,url) VALUES
('dtf_paper','Stock DTF dan Kertas','https://docs.google.com/spreadsheets/d/1qSXiNUIUOmJ_yPmtpB8CLEEk2OZCHMRkhH7m6b1NPM8/edit?gid=143541986#gid=143541986'),
('fabric','Stock Kain','https://docs.google.com/spreadsheets/d/1Ipag7VfEh8yyEBjhU52dL0TlE9bfh4lhcwow8CZ_HJA/edit?gid=255000558#gid=255000558')
ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.stock_shortcuts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_shortcuts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_shortcuts TO authenticated;
GRANT UPDATE (label,url,version) ON public.stock_shortcuts TO authenticated;
DROP POLICY IF EXISTS stock_shortcuts_read ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_read ON public.stock_shortcuts FOR SELECT TO authenticated USING(public.printex_staff());
DROP POLICY IF EXISTS stock_shortcuts_edit ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_edit ON public.stock_shortcuts FOR UPDATE TO authenticated
USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='admin'))
WITH CHECK(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='admin'));
COMMIT;

-- Extend shortcut editing to active Owner accounts. Requires migration 0017.
BEGIN;
DROP POLICY IF EXISTS stock_shortcuts_edit ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_edit ON public.stock_shortcuts FOR UPDATE TO authenticated
USING(public.printex_admin()) WITH CHECK(public.printex_admin());
COMMIT;
