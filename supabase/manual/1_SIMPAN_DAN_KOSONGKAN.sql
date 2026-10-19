-- LANGKAH 1 — SIMPAN AKUN & PENGATURAN SALATIGA, LALU KOSONGKAN DATABASE LAMA (sekali saja)
-- Untuk project Supabase yang masih memakai struktur cabang. Database baru yang masih kosong
-- tidak perlu langkah ini: langsung jalankan supabase/SETUP.sql.
--
-- DISIMPAN sementara di skema printex_keep (dipulihkan di langkah 3):
--   - akun Owner, Admin dan Operator cabang Salatiga (nama, role, status aktif; password tetap)
--   - pengaturan Salatiga: waktu kerja, operator standar, kecepatan desain, daftar mesin,
--     link stok, dan nomor Customer Service
-- DIHAPUS PERMANEN:
--   - semua order, customer, riwayat, laporan, catatan Mulai/Selesai, jam operator
--   - semua tabel, fungsi dan aturan di skema public (dibangun ulang di langkah 2)
--   - akun login Owner Pusat, serta akun cabang selain Salatiga
-- Akun login yang dipertahankan TIDAK perlu dibuat ulang dan password-nya tidak berubah.
--
-- Pengaman: dibatalkan bila tidak ada akun Owner aktif di Salatiga, agar tidak ada yang terkunci.
-- Seluruh pekerjaan dalam SATU blok: semua berhasil, atau tidak ada yang berubah.

DO $$
DECLARE salatiga uuid; owners integer;
BEGIN
 IF to_regclass('public.branches') IS NULL THEN
  RAISE EXCEPTION 'Database ini tidak memakai struktur cabang. Langkah 1 tidak diperlukan.';
 END IF;
 SELECT id INTO salatiga FROM public.branches WHERE name='Salatiga';
 IF salatiga IS NULL THEN RAISE EXCEPTION 'Cabang Salatiga tidak ditemukan.'; END IF;
 SELECT count(*) INTO owners FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.branch_id=salatiga AND p.role='owner' AND p.is_active AND u.deleted_at IS NULL;
 IF owners = 0 THEN
  RAISE EXCEPTION 'Tidak ada akun Owner aktif di Salatiga. Jadikan satu akun sebagai Owner Salatiga dulu (Pusat Admin → Akun), lalu jalankan langkah 1 lagi. Tanpa itu, tidak ada yang bisa login sebagai Owner.';
 END IF;

 -- Cadangan sementara (di luar skema public, jadi tidak ikut terhapus).
 DROP SCHEMA IF EXISTS printex_keep CASCADE;
 CREATE SCHEMA printex_keep;
 CREATE TABLE printex_keep.profiles AS
  SELECT p.id,p.full_name,p.role,p.is_active FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.branch_id=salatiga AND p.role IN ('owner','admin','operator') AND u.deleted_at IS NULL AND p.deletion_requested_at IS NULL;
 CREATE TABLE printex_keep.removed_users AS
  SELECT p.id FROM public.profiles p WHERE p.id NOT IN (SELECT id FROM printex_keep.profiles);
 CREATE TABLE printex_keep.settings AS
  SELECT c.shifts,c.shift_hours,c.planned_downtime_minutes,c.operators_printing,c.operators_dtf,c.operators_press,c.operators_design,c.design_orders_per_hour
  FROM public.branch_production_capacity c WHERE c.branch_id=salatiga;
 CREATE TABLE printex_keep.machines AS
  SELECT kind,name,created_at FROM public.branch_machines WHERE branch_id=salatiga AND removed_at IS NULL;
 CREATE TABLE printex_keep.stock_shortcuts AS
  SELECT id,label,url FROM public.branch_stock_shortcuts WHERE branch_id=salatiga;
 CREATE TABLE printex_keep.customer_service AS
  SELECT whatsapp_number FROM public.customer_service_settings;

 -- Kosongkan skema public dan siapkan lagi hak akses standar Supabase.
 DROP SCHEMA public CASCADE;
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

 -- Hapus akun login Owner Pusat dan akun cabang lain.
 DELETE FROM auth.users WHERE id IN (SELECT id FROM printex_keep.removed_users);
 RAISE NOTICE 'Disimpan: % akun Salatiga. Dihapus: % akun.', (SELECT count(*) FROM printex_keep.profiles), (SELECT count(*) FROM printex_keep.removed_users);
END $$;

-- Cek: akun yang akan dipulihkan di langkah 3.
SELECT full_name AS nama, role, is_active AS aktif FROM printex_keep.profiles ORDER BY role, full_name;
