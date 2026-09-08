BEGIN;
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
COMMIT;
