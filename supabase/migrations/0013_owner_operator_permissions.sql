-- Rename existing accounts in place and enforce Operator permissions in the database.
-- Run once after migration 0012; safe to run again. No orders or history are rewritten.
BEGIN;
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
