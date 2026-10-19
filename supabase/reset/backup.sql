-- ===== Bagian 1: simpan akun & pengaturan, lalu kosongkan skema public =====
-- Bekerja dari kondisi apa pun: database cabang lama (hanya Salatiga dipertahankan), database lama
-- tanpa cabang, database satu lokasi yang sudah ada, atau reset sebelumnya yang terhenti di tengah.
DO $$
DECLARE salatiga uuid; owners integer; had_profiles boolean;
BEGIN
 had_profiles := to_regclass('public.profiles') IS NOT NULL;
 IF NOT had_profiles AND to_regnamespace('printex_keep') IS NOT NULL THEN
  -- Reset sebelumnya terhenti setelah bagian 1: pakai cadangan yang sudah ada.
  RAISE NOTICE 'Melanjutkan reset sebelumnya dengan cadangan yang sudah tersimpan.';
 ELSE
  DROP SCHEMA IF EXISTS printex_keep CASCADE;
  CREATE SCHEMA printex_keep;
  CREATE TABLE printex_keep.profiles (id uuid, full_name text, role text, is_active boolean);
  CREATE TABLE printex_keep.settings (shifts smallint, shift_hours numeric, planned_downtime_minutes integer,
   operators_printing smallint, operators_dtf smallint, operators_press smallint, operators_design smallint, design_orders_per_hour numeric);
  CREATE TABLE printex_keep.machines (kind text, name text, created_at timestamptz);
  CREATE TABLE printex_keep.stock_shortcuts (id text, label text, url text);
  CREATE TABLE printex_keep.customer_service (whatsapp_number text);

  IF to_regclass('public.branches') IS NOT NULL THEN
   -- Database cabang lama: hanya akun dan pengaturan Salatiga yang dipertahankan.
   EXECUTE 'SELECT id FROM public.branches WHERE name=''Salatiga''' INTO salatiga;
   IF salatiga IS NULL THEN RAISE EXCEPTION 'Cabang Salatiga tidak ditemukan.'; END IF;
   EXECUTE 'INSERT INTO printex_keep.profiles SELECT p.id,p.full_name,p.role,p.is_active FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE p.branch_id=$1 AND p.role IN (''owner'',''admin'',''operator'') AND u.deleted_at IS NULL AND p.deletion_requested_at IS NULL' USING salatiga;
   IF to_regclass('public.branch_production_capacity') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.settings SELECT shifts,shift_hours,planned_downtime_minutes,operators_printing,operators_dtf,operators_press,operators_design,design_orders_per_hour
     FROM public.branch_production_capacity WHERE branch_id=$1' USING salatiga;
   END IF;
   IF to_regclass('public.branch_machines') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.machines SELECT kind,name,created_at FROM public.branch_machines WHERE branch_id=$1 AND removed_at IS NULL' USING salatiga;
   END IF;
   IF to_regclass('public.branch_stock_shortcuts') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.stock_shortcuts SELECT id,label,url FROM public.branch_stock_shortcuts WHERE branch_id=$1' USING salatiga;
   END IF;
  ELSIF had_profiles THEN
   -- Database tanpa cabang (lama atau satu lokasi): semua akun ikut; nama role lama dikonversi.
   EXECUTE 'INSERT INTO printex_keep.profiles SELECT p.id,p.full_name,CASE p.role WHEN ''superadmin'' THEN ''owner'' WHEN ''staff'' THEN ''operator'' ELSE p.role END,p.is_active
    FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.role IN (''owner'',''admin'',''operator'',''superadmin'',''staff'') AND u.deleted_at IS NULL';
   IF to_regclass('public.production_settings') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.settings SELECT shifts,shift_hours,planned_downtime_minutes,operators_printing,operators_dtf,operators_press,operators_design,design_orders_per_hour FROM public.production_settings';
   END IF;
   IF to_regclass('public.production_machines') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.machines SELECT kind,name,created_at FROM public.production_machines WHERE removed_at IS NULL';
   END IF;
   IF to_regclass('public.stock_shortcuts') IS NOT NULL THEN
    EXECUTE 'INSERT INTO printex_keep.stock_shortcuts SELECT id,label,url FROM public.stock_shortcuts';
   END IF;
  END IF;
  IF to_regclass('public.customer_service_settings') IS NOT NULL THEN
   EXECUTE 'INSERT INTO printex_keep.customer_service SELECT whatsapp_number FROM public.customer_service_settings LIMIT 1';
  END IF;

  -- Pengaman: jangan sampai tidak ada yang bisa login sebagai Owner.
  SELECT count(*) INTO owners FROM printex_keep.profiles WHERE role='owner' AND is_active;
  IF had_profiles AND owners = 0 THEN
   RAISE EXCEPTION 'Tidak ada akun Owner aktif yang ikut disimpan. Jadikan satu akun sebagai Owner (Salatiga) dulu di Pusat Admin → Akun, lalu jalankan reset lagi. Tidak ada yang diubah.';
  END IF;
  -- Akun yang tidak ikut ke Salatiga (Owner Pusat dan akun cabang lain) dihapus loginnya.
  CREATE TABLE printex_keep.removed_users (id uuid);
  IF had_profiles THEN
   EXECUTE 'INSERT INTO printex_keep.removed_users SELECT p.id FROM public.profiles p WHERE p.id NOT IN (SELECT id FROM printex_keep.profiles)';
  END IF;
 END IF;

 -- Kosongkan skema public dan siapkan lagi hak akses standar Supabase.
 DROP SCHEMA IF EXISTS public CASCADE;
 CREATE SCHEMA public;
 GRANT USAGE ON SCHEMA public TO PUBLIC;
 PERFORM 1 FROM pg_roles WHERE rolname='service_role';
 IF FOUND THEN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role';
  EXECUTE 'GRANT ALL ON SCHEMA public TO service_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role';
 ELSE
  EXECUTE 'GRANT USAGE ON SCHEMA public TO anon, authenticated';
 END IF;
 DELETE FROM auth.users WHERE id IN (SELECT id FROM printex_keep.removed_users);
END $$;
