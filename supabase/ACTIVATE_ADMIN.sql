-- Run in Supabase SQL Editor after creating this user in Authentication > Users.
BEGIN;
DO $$
DECLARE admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = 'fathalifian@gmail.com';
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'Buat akun fathalifian@gmail.com di Authentication > Users terlebih dahulu, lalu jalankan ACTIVATE_ADMIN.sql kembali.';
  END IF;
  INSERT INTO public.profiles(id, full_name, role, is_active)
  VALUES(admin_id, 'Admin Printex', 'superadmin', true)
  ON CONFLICT (id) DO UPDATE SET role = 'superadmin', is_active = true, updated_at = now();
END $$;
COMMIT;
