-- ===== Bagian 3: pulihkan akun & pengaturan, lalu hapus cadangan =====
DO $$
DECLARE s record;
BEGIN
 -- Akun: login dan password tetap; profil dibuat lagi dengan role dan status sebelumnya.
 INSERT INTO public.profiles(id,full_name,role,is_active)
  SELECT k.id,k.full_name,k.role,k.is_active FROM printex_keep.profiles k JOIN auth.users u ON u.id=k.id
 ON CONFLICT (id) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active,updated_at=now();
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role='owner' AND is_active) THEN
  RAISE NOTICE 'Belum ada akun Owner. Buat akun di Authentication → Users, lalu jalankan supabase/ACTIVATE_ADMIN.sql.';
 END IF;

 -- Waktu kerja dan operator standar (tanpa cadangan: standar 9 jam, istirahat & setup 2 jam).
 SELECT * INTO s FROM printex_keep.settings LIMIT 1;
 IF FOUND THEN
  UPDATE public.production_settings SET shifts=s.shifts,shift_hours=s.shift_hours,planned_downtime_minutes=s.planned_downtime_minutes,
   operators_printing=s.operators_printing,operators_dtf=s.operators_dtf,operators_press=s.operators_press,operators_design=s.operators_design,
   design_orders_per_hour=s.design_orders_per_hour,version=version+1;
 END IF;

 -- Mesin tersimpan menggantikan mesin bawaan (belum ada order yang memakainya).
 IF EXISTS (SELECT 1 FROM printex_keep.machines) THEN
  DELETE FROM public.production_machines;
  INSERT INTO public.production_machines(kind,name,created_at) SELECT kind,name,created_at FROM printex_keep.machines;
 END IF;

 -- Link stok (link kosong = tombol nonaktif) dan nomor Customer Service.
 UPDATE public.stock_shortcuts t SET label=k.label,url=k.url,version=t.version+1
  FROM printex_keep.stock_shortcuts k WHERE k.id=t.id AND (k.url='' OR k.url ~ '^https://[^[:space:]]+$');
 UPDATE public.customer_service_settings SET whatsapp_number=coalesce((SELECT whatsapp_number FROM printex_keep.customer_service LIMIT 1),'');

 DROP SCHEMA printex_keep CASCADE;
END $$;

-- ===== Cek hasil =====
SELECT p.full_name AS nama, p.role, p.is_active AS aktif, u.email
FROM public.profiles p JOIN auth.users u ON u.id=p.id ORDER BY p.role, p.full_name;
