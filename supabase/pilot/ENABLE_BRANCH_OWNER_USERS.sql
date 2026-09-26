-- Apply after ACTIVATE_SALATIGA_SEMARANG.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.printex_branch_manages_user(p_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles actor JOIN public.profiles target ON target.id=p_target
 WHERE actor.id=auth.uid() AND actor.is_active AND actor.role='owner'
 AND actor.branch_id=target.branch_id AND target.role IN ('admin','operator')
 AND public.printex_branch_access(actor.branch_id));
$$;
REVOKE ALL ON FUNCTION public.printex_branch_manages_user(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_branch_manages_user(uuid) TO authenticated;
DROP POLICY IF EXISTS online_read ON public.profiles;
CREATE POLICY online_read ON public.profiles FOR SELECT TO authenticated
USING(id=auth.uid() OR public.printex_central_owner() OR public.printex_branch_manages_user(id));

CREATE OR REPLACE FUNCTION public.printex_list_users() RETURNS TABLE(id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles actor WHERE actor.id=auth.uid() AND actor.is_active AND actor.role IN ('central_owner','owner'))
 THEN RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active
 FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE (u.deleted_at IS NULL OR p.deletion_requested_at IS NOT NULL)
 AND (public.printex_central_owner() OR public.printex_branch_manages_user(p.id));
END $$;
CREATE OR REPLACE FUNCTION public.printex_manage_user(p_id uuid,p_name text,p_role text,p_active boolean,p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.profiles; actor public.profiles;
BEGIN
  -- Serialize role changes so concurrent removals cannot remove the last Owner.
  PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('central_owner','owner') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501'; END IF;
  SELECT * INTO target FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
  IF actor.role='owner' AND (
    actor.branch_id IS NULL OR target.branch_id IS DISTINCT FROM actor.branch_id
    OR target.role NOT IN ('admin','operator')
    OR (NOT p_delete AND (p_role IS NULL OR p_role NOT IN ('admin','operator')))
    OR NOT public.printex_branch_access(actor.branch_id)
  ) THEN RAISE EXCEPTION 'Owner Cabang hanya mengelola Admin dan Operator cabangnya' USING ERRCODE='42501'; END IF;

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


CREATE OR REPLACE FUNCTION public.printex_manage_branch_user(p_id uuid,p_name text,p_role text,p_active boolean,p_branch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; target public.profiles;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('central_owner','owner') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM public.profiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
 IF actor.role='central_owner' THEN
   IF p_role<>'central_owner' THEN
     IF p_branch IS NULL THEN RAISE EXCEPTION 'Pilih cabang akun'; END IF;
     PERFORM public.printex_assign_branch(p_id,p_branch);
   END IF;
 ELSE
   IF p_role IS NULL OR p_role NOT IN ('admin','operator') OR p_branch IS DISTINCT FROM actor.branch_id
     OR NOT public.printex_branch_access(actor.branch_id) THEN
     RAISE EXCEPTION 'Owner Cabang hanya mengelola Admin dan Operator cabangnya' USING ERRCODE='42501';
   END IF;
   -- Only a new inactive profile created by this owner's server action can be assigned.
   -- raw_app_meta_data cannot be forged by client-side Auth updates.
   IF target.branch_id IS NULL AND NOT target.is_active AND target.role='operator'
     AND EXISTS(SELECT 1 FROM auth.users WHERE id=p_id
       AND raw_app_meta_data->>'provisioned_by'=auth.uid()::text
       AND raw_app_meta_data->>'provisioned_branch'=actor.branch_id::text) THEN
     UPDATE public.profiles SET branch_id=actor.branch_id WHERE id=p_id;
   ELSIF target.branch_id IS DISTINCT FROM actor.branch_id OR target.role NOT IN ('admin','operator') THEN
     RAISE EXCEPTION 'Akun di luar hak kelola cabang' USING ERRCODE='42501';
   END IF;
 END IF;
 PERFORM public.printex_manage_user(p_id,p_name,p_role,p_active,false);
END $$;
REVOKE ALL ON FUNCTION public.printex_manage_branch_user(uuid,text,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_manage_branch_user(uuid,text,text,boolean,uuid) TO authenticated;
COMMIT;
