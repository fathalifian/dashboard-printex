-- Production branch migration. Apply in order after base migrations.
BEGIN;
CREATE TABLE IF NOT EXISTS public.branches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.branches(id,name) VALUES
('11111111-1111-4111-8111-111111111111','Salatiga'),
('22222222-2222-4222-8222-222222222222','Semarang') ON CONFLICT DO NOTHING;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK(role IN ('central_owner','owner','admin','operator'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.process_history ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.order_photo_cleanup ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
DO $$ DECLARE selected uuid; BEGIN
 IF EXISTS(SELECT 1 FROM public.orders WHERE branch_id IS NULL)
 OR EXISTS(SELECT 1 FROM public.profiles WHERE branch_id IS NULL AND role<>'central_owner') THEN
   SELECT id INTO selected FROM public.branches WHERE name=current_setting('printex.legacy_branch',true);
   IF selected IS NULL THEN RAISE EXCEPTION 'Pilih cabang data lama: SET printex.legacy_branch = Salatiga atau Semarang'; END IF;
   -- Branch metadata backfill must not rewrite archive dates or increment versions.
   ALTER TABLE public.orders DISABLE TRIGGER USER;
   UPDATE public.orders SET branch_id=selected WHERE branch_id IS NULL;
   ALTER TABLE public.orders ENABLE TRIGGER USER;
   UPDATE public.customers SET branch_id=selected WHERE branch_id IS NULL;
   UPDATE public.process_history SET branch_id=selected WHERE branch_id IS NULL;
   UPDATE public.profiles SET branch_id=selected WHERE branch_id IS NULL AND role<>'central_owner';
   UPDATE public.order_photo_cleanup SET branch_id=selected WHERE branch_id IS NULL;
 END IF;
END $$;
ALTER TABLE public.orders ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.process_history ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS orders_branch_created ON public.orders(branch_id,created_at);
CREATE INDEX IF NOT EXISTS customers_branch ON public.customers(branch_id);
CREATE INDEX IF NOT EXISTS history_branch_time ON public.process_history(branch_id,occurred_at);
CREATE OR REPLACE FUNCTION public.printex_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('central_owner','owner','admin','operator'));
$$;
CREATE OR REPLACE FUNCTION public.printex_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('central_owner','owner','admin'));
$$;
CREATE OR REPLACE FUNCTION public.printex_central_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='central_owner');
$$;
CREATE OR REPLACE FUNCTION public.printex_branch_access(p_branch uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
 AND (p.role='central_owner' OR (p.branch_id=p_branch AND p.role IN ('owner','admin','operator'))))
 AND EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch AND is_active);
$$;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.branches TO authenticated;
DROP POLICY IF EXISTS branches_read ON public.branches;
CREATE POLICY branches_read ON public.branches FOR SELECT TO authenticated USING(public.printex_branch_access(id));
DO $$ DECLARE t text; p record; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','customers','process_history'] LOOP
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
  END LOOP;
  EXECUTE format('CREATE POLICY branch_read ON public.%I FOR SELECT TO authenticated USING(public.printex_branch_access(branch_id))',t);
 END LOOP;
 -- Legacy tables are not used by the board. Keep them private to the central owner
 -- until their workflows acquire explicit branch membership.
 FOREACH t IN ARRAY ARRAY['machines','order_step_events','order_activities','production_schedules','schedule_items'] LOOP
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
  END LOOP;
  EXECUTE format('CREATE POLICY central_read ON public.%I FOR SELECT TO authenticated USING(public.printex_central_owner())',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS online_read ON public.profiles;
CREATE POLICY online_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid() OR public.printex_central_owner());
CREATE OR REPLACE FUNCTION public.printex_history_branch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT branch_id INTO NEW.branch_id FROM public.orders WHERE id=NEW.order_id;
 IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'Cabang riwayat tidak ditemukan'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS history_branch ON public.process_history;
CREATE TRIGGER history_branch BEFORE INSERT ON public.process_history FOR EACH ROW EXECUTE FUNCTION public.printex_history_branch();
CREATE OR REPLACE FUNCTION public.printex_mutate_order(p_action text, p_order_id uuid, p_expected_version bigint, p_data jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.orders; customer_uuid uuid; stage_uuid uuid; result_id uuid; actor_role text; source_code text; selected_branch uuid;
BEGIN
  -- Lock the authenticated profile until commit, including against concurrent role changes.
  SELECT p.role INTO actor_role FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('central_owner','owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','edit','move','delete','archive','finish') THEN RAISE EXCEPTION 'Aksi tidak valid'; END IF;
  IF actor_role='operator' AND p_action<>'move' THEN
    RAISE EXCEPTION 'Operator tidak dapat menambah, mengedit, menghapus, atau mengarsipkan order' USING ERRCODE='42501';
  END IF;
  IF p_action IN ('create','edit') THEN
    IF length(trim(p_data->>'customerPhone')) > 30 THEN
      RAISE EXCEPTION 'Nomor WhatsApp maksimal 30 karakter';
    END IF;
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
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id) THEN
      IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND public.printex_branch_access(branch_id)) THEN
        RAISE EXCEPTION 'Order tidak tersedia untuk cabang Anda' USING ERRCODE='42501';
      END IF;
      RETURN p_order_id;
    END IF;
    selected_branch:=nullif(p_data->>'branchId','')::uuid;
    IF selected_branch IS NULL THEN SELECT branch_id INTO selected_branch FROM public.profiles WHERE id=auth.uid(); END IF;
    IF NOT public.printex_branch_access(selected_branch) THEN RAISE EXCEPTION 'Pilih cabang yang dapat Anda akses' USING ERRCODE='42501'; END IF;
    INSERT INTO public.customers(branch_id,name,phone) VALUES(selected_branch,trim(p_data->>'customerName'),nullif(trim(p_data->>'customerPhone'),'')) RETURNING id INTO customer_uuid;
    INSERT INTO public.orders(branch_id,id,spk_code,customer_id,production_type,meter,customer_type,order_date,due_at,notes,created_by)
    VALUES(selected_branch,p_order_id,'SPK-'||nextval('public.printex_spk_seq'),customer_uuid,p_data->>'productionType',
      (p_data->>'meter')::numeric,p_data->>'customerType',(p_data->>'orderDate')::date,(p_data->>'dueDate')::date,
      COALESCE(p_data->>'notes',''),auth.uid()) RETURNING id INTO result_id;
    RETURN result_id;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order sudah dihapus atau tidak ditemukan'; END IF;
  IF NOT public.printex_branch_access(o.branch_id) THEN RAISE EXCEPTION 'Order tidak tersedia untuk cabang Anda' USING ERRCODE='42501'; END IF;
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
    UPDATE public.customers SET name=trim(p_data->>'customerName'),phone=CASE WHEN p_data ? 'customerPhone' THEN nullif(trim(p_data->>'customerPhone'),'') ELSE phone END,updated_at=statement_timestamp() WHERE id=o.customer_id;
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
CREATE OR REPLACE FUNCTION public.printex_set_order_photo(p_order_id uuid,p_expected_version bigint,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('central_owner','owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah foto order' USING ERRCODE='42501'; END IF;
  IF p_path IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_path,16));
    IF EXISTS(SELECT 1 FROM public.order_photo_cleanup WHERE path=p_path AND claimed) THEN
      RAISE EXCEPTION 'Foto sudah dijadwalkan untuk dibersihkan. Unggah ulang foto.';
    END IF;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF NOT public.printex_branch_access(o.branch_id) THEN RAISE EXCEPTION 'Foto tidak tersedia untuk cabang Anda' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.printex_queue_old_photo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.photo_path IS NOT NULL AND (TG_OP='DELETE' OR OLD.photo_path IS DISTINCT FROM NEW.photo_path) THEN
  INSERT INTO public.order_photo_cleanup(path,branch_id) VALUES(OLD.photo_path,OLD.branch_id) ON CONFLICT(path) DO UPDATE SET branch_id=EXCLUDED.branch_id;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.printex_photo_branch_access(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders WHERE id::text=split_part(p_path,'/',1) AND public.printex_branch_access(branch_id))
 OR EXISTS(SELECT 1 FROM public.order_photo_cleanup WHERE path=p_path AND public.printex_branch_access(branch_id));
$$;
DROP POLICY IF EXISTS order_photos_read ON storage.objects;
CREATE POLICY order_photos_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='order-photos' AND public.printex_photo_branch_access(name));
DROP POLICY IF EXISTS order_photos_upload ON storage.objects;
CREATE POLICY order_photos_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='order-photos' AND public.printex_admin() AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
 AND EXISTS(SELECT 1 FROM public.orders WHERE id::text=split_part(name,'/',1) AND archived_at IS NULL AND public.printex_branch_access(branch_id)));
CREATE OR REPLACE FUNCTION public.printex_claim_photo_cleanup(p_path text DEFAULT NULL)
RETURNS TABLE(path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat membersihkan foto' USING ERRCODE='42501'; END IF;
  -- A missing object after a successful API deletion needs no remaining queue row.
  DELETE FROM public.order_photo_cleanup q WHERE q.queued_at < now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND public.printex_photo_branch_access(s.name) AND s.name=q.path);
  FOR candidate IN
    SELECT s.name FROM storage.objects s
    WHERE s.bucket_id='order-photos' AND public.printex_photo_branch_access(s.name)
      AND (CASE WHEN p_path IS NOT NULL THEN s.name=p_path ELSE
        s.created_at < now()-interval '24 hours' OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=s.name) END)
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=s.name)
    ORDER BY s.created_at,s.name LIMIT 50
  LOOP
    -- The photo-link RPC takes the same lock. After this claim it cannot attach the path.
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate,16));
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=candidate) THEN
      INSERT INTO public.order_photo_cleanup AS q(path,claimed,branch_id)
      VALUES(candidate,true,(SELECT branch_id FROM public.orders WHERE id::text=split_part(candidate,'/',1)))
        ON CONFLICT ON CONSTRAINT order_photo_cleanup_pkey DO UPDATE SET claimed=true;
      path:=candidate; RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.printex_claim_photo_cleanup(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_claim_photo_cleanup(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.printex_photo_deletable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.printex_admin() AND public.printex_photo_branch_access(p_path)
    AND EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.path=p_path AND q.claimed)
    AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=p_path);
$$;
REVOKE ALL ON FUNCTION public.printex_photo_deletable(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_photo_deletable(text) TO authenticated;
DROP POLICY IF EXISTS order_photos_delete ON storage.objects;
CREATE POLICY order_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='order-photos' AND public.printex_photo_deletable(name));


CREATE OR REPLACE FUNCTION public.printex_branch_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('branches',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.branches WHERE public.printex_branch_access(id)),
 'central',public.printex_central_owner(),'branchId',(SELECT branch_id FROM public.profiles WHERE id=auth.uid()));
END $$;
-- Central management is intentionally required in this pilot.
CREATE OR REPLACE FUNCTION public.printex_list_users() RETURNS TABLE(id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_central_owner() THEN RAISE EXCEPTION 'Hanya Owner Pusat yang dapat mengelola akun' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE u.deleted_at IS NULL;
END $$;
CREATE OR REPLACE FUNCTION public.printex_manage_user(p_id uuid,p_name text,p_role text,p_active boolean,p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.profiles;
BEGIN
  -- Serialize role changes so concurrent removals cannot remove the last Owner.
  PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='central_owner') THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
  IF p_id=auth.uid() AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'central_owner') THEN
    RAISE EXCEPTION 'Tidak dapat menghapus, menonaktifkan, atau menurunkan role akun sendiri';
  END IF;
  IF target.role='central_owner' AND target.is_active AND (p_delete OR p_active IS DISTINCT FROM true OR p_role IS DISTINCT FROM 'central_owner')
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='central_owner' AND is_active AND id<>p_id) THEN
    RAISE EXCEPTION 'Minimal satu Owner aktif harus tersedia';
  END IF;
  IF p_delete THEN
    UPDATE public.profiles SET is_active=false,deletion_requested_at=now(),updated_at=now() WHERE id=p_id;
  ELSE
    IF target.deletion_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Penghapusan akun sedang diproses. Selesaikan penghapusan terlebih dahulu'; END IF;
    IF nullif(trim(p_name),'') IS NULL OR length(p_name)>100 OR p_role IS NULL OR p_role NOT IN ('central_owner','owner','admin','operator') OR p_active IS NULL THEN
      RAISE EXCEPTION 'Nama, role, atau status akun tidak valid';
    END IF;
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Akun sudah dihapus'; END IF;
    UPDATE public.profiles SET full_name=trim(p_name),role=p_role,is_active=p_active,updated_at=now() WHERE id=p_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.printex_assign_branch(p_user uuid,p_branch uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_central_owner() THEN RAISE EXCEPTION 'Hanya Owner Pusat' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch AND is_active) THEN RAISE EXCEPTION 'Cabang tidak valid'; END IF;
 UPDATE public.profiles SET branch_id=p_branch WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.printex_central_owner(),public.printex_branch_access(uuid),
public.printex_photo_branch_access(text),public.printex_branch_context(),public.printex_assign_branch(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_central_owner(),public.printex_branch_access(uuid),
public.printex_photo_branch_access(text),public.printex_branch_context(),public.printex_assign_branch(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.printex_online_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schema_version',8,'branches_enabled',true,'realtime_tables',
 (SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;

CREATE OR REPLACE FUNCTION public.printex_manage_branch_user(p_id uuid,p_name text,p_role text,p_active boolean,p_branch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_central_owner() THEN RAISE EXCEPTION 'Hanya Owner Pusat' USING ERRCODE='42501'; END IF;
 IF p_role<>'central_owner' THEN
   IF p_branch IS NULL THEN RAISE EXCEPTION 'Pilih cabang akun'; END IF;
   PERFORM public.printex_assign_branch(p_id,p_branch);
 END IF;
 PERFORM public.printex_manage_user(p_id,p_name,p_role,p_active,false);
END $$;
REVOKE ALL ON FUNCTION public.printex_manage_branch_user(uuid,text,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_manage_branch_user(uuid,text,text,boolean,uuid) TO authenticated;
COMMIT;
