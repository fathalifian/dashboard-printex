-- Akun karyawan: profil per login Supabase Auth, peran Owner/Admin/Operator, dan pengelolaan akun oleh Owner.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'operator' CHECK (role IN ('owner','admin','operator')),
  is_active boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Karyawan aktif (semua peran) dan pengelola (Owner/Admin). Dipakai oleh RLS dan RPC.
CREATE FUNCTION public.printex_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin','operator'));
$$;
CREATE FUNCTION public.printex_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role IN ('owner','admin'));
$$;

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated
  USING (id=auth.uid() OR public.printex_admin());

-- Login baru selalu menjadi Operator nonaktif sampai diaktifkan Owner (metadata pendaftar diabaikan).
CREATE FUNCTION public.printex_new_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,full_name,role,is_active)
  VALUES(NEW.id,coalesce(NEW.raw_user_meta_data->>'full_name',NEW.email,'Karyawan'),'operator',false)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS printex_auth_profile ON auth.users;
CREATE TRIGGER printex_auth_profile AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.printex_new_profile();

CREATE FUNCTION public.printex_list_users()
RETURNS TABLE(id uuid, email text, full_name text, role text, is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.role='owner') THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengelola akun' USING ERRCODE='42501';
  END IF;
  -- Akun yang penghapusannya belum selesai tetap tampil agar bisa dicoba hapus lagi.
  RETURN QUERY SELECT p.id,u.email::text,p.full_name,p.role,p.is_active
    FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE u.deleted_at IS NULL OR p.deletion_requested_at IS NOT NULL
    ORDER BY p.created_at,p.id;
END $$;

-- Ubah nama/peran/status, atau tandai untuk dihapus (login dihapus server lewat Auth Admin API).
CREATE FUNCTION public.printex_manage_user(p_id uuid, p_name text, p_role text, p_active boolean, p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.profiles;
BEGIN
  -- Serialisasi agar dua perubahan bersamaan tidak menghapus Owner terakhir.
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
    RETURN;
  END IF;
  IF target.deletion_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'Penghapusan akun sedang diproses. Selesaikan penghapusan terlebih dahulu';
  END IF;
  IF nullif(trim(p_name),'') IS NULL OR length(p_name)>100 OR p_role IS NULL
     OR p_role NOT IN ('owner','admin','operator') OR p_active IS NULL THEN
    RAISE EXCEPTION 'Nama, role, atau status akun tidak valid';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Akun sudah dihapus'; END IF;
  UPDATE public.profiles SET full_name=trim(p_name),role=p_role,is_active=p_active,updated_at=now() WHERE id=p_id;
END $$;
