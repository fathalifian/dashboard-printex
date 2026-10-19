-- LANGKAH 3 — PULIHKAN AKUN & PENGATURAN SALATIGA (setelah langkah 2: supabase/SETUP.sql)
-- Mengembalikan profil akun (nama, role, status aktif), waktu kerja, operator standar,
-- daftar mesin, link stok dan nomor Customer Service yang disimpan di langkah 1,
-- lalu menghapus skema cadangan printex_keep. Satu blok: semua berhasil, atau tidak ada yang berubah.

DO $$
DECLARE s record;
BEGIN
 IF to_regclass('printex_keep.profiles') IS NULL THEN RAISE EXCEPTION 'Cadangan langkah 1 tidak ditemukan.'; END IF;
 IF to_regclass('public.production_settings') IS NULL THEN RAISE EXCEPTION 'Jalankan langkah 2 (supabase/SETUP.sql) terlebih dahulu.'; END IF;

 -- Akun: login dan password tetap; profil dibuat lagi dengan role dan status sebelumnya.
 INSERT INTO public.profiles(id,full_name,role,is_active)
  SELECT k.id,k.full_name,k.role,k.is_active FROM printex_keep.profiles k JOIN auth.users u ON u.id=k.id
 ON CONFLICT (id) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active,updated_at=now();

 -- Waktu kerja dan operator standar.
 SELECT * INTO s FROM printex_keep.settings LIMIT 1;
 IF FOUND THEN
  UPDATE public.production_settings SET shifts=s.shifts,shift_hours=s.shift_hours,planned_downtime_minutes=s.planned_downtime_minutes,
   operators_printing=s.operators_printing,operators_dtf=s.operators_dtf,operators_press=s.operators_press,operators_design=s.operators_design,
   design_orders_per_hour=s.design_orders_per_hour,version=version+1;
 END IF;

 -- Mesin: daftar Salatiga menggantikan mesin bawaan (belum ada order yang memakainya).
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

-- Cek: akun dan pengaturan yang aktif sekarang.
SELECT p.full_name AS nama, p.role, p.is_active AS aktif, u.email
FROM public.profiles p JOIN auth.users u ON u.id=p.id ORDER BY p.role, p.full_name;
