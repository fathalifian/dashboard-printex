-- LANGKAH 5 (NANTI, SAAT MULAI DIPAKAI SUNGGUHAN) — RESET GO-LIVE PRINTEX
-- Menghapus SELURUH data order (termasuk data uji) secara permanen.
-- Jalankan sekali di Supabase SQL Editor, di luar jam kerja.
-- Seluruh pekerjaan ada dalam SATU blok: semua berhasil, atau tidak ada yang berubah.
--
-- DIHAPUS : order, customer, riwayat proses, event/aktivitas order, jadwal,
--           antrean foto, catatan Mulai/Selesai cetak, jam operator per hari,
--           seluruh ringkasan & rincian laporan, log sinkronisasi.
-- DISIMPAN: akun login & profil, nomor Customer Service, shortcut stok,
--           tahapan produksi, mesin, operator & jam kerja.
--
-- File foto di Storage tidak dihapus lewat SQL. Setelah script ini berhasil,
-- kosongkan bucket "order-photos" dari menu Storage di dashboard Supabase.
-- Semua pengguna perlu memuat ulang (refresh) halaman setelah reset.

DO $$
DECLARE
  -- Urutan tidak berpengaruh: semua tabel di-TRUNCATE dalam satu perintah.
  wanted text[] := ARRAY[
    'orders','customers','process_history','order_step_events','order_activities',
    'schedule_items','production_schedules','order_photo_cleanup','photo_cleanup_requests',
    'report_contributions','report_daily_summaries','report_order_payloads',
    'report_refresh_queue','printex_row_changes','print_runs','operator_shifts'];
  found text[];
BEGIN
  IF to_regclass('public.production_machines') IS NULL THEN
    RAISE EXCEPTION 'Jalankan supabase/SETUP.sql terlebih dahulu.';
  END IF;
  SELECT array_agg(format('public.%I', c.relname) ORDER BY c.relname) INTO found
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(wanted);
  -- Tanpa CASCADE: jika ada tabel lain yang masih mereferensikan data ini,
  -- TRUNCATE gagal dan semuanya dibatalkan, bukan menghapus diam-diam.
  EXECUTE 'TRUNCATE TABLE ' || array_to_string(found, ', ');

  -- Nomor SPK otomatis (klien lama) mulai lagi dari awal.
  IF to_regclass('public.printex_spk_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.printex_spk_seq RESTART;
  END IF;

  -- Cursor sinkronisasi maju agar perangkat tidak memakai cursor lama.
  UPDATE public.printex_sync_clock SET revision = revision + 1 WHERE singleton;

  -- Pemeriksaan akhir: harus 0 order dan data akun tetap ada.
  IF EXISTS (SELECT 1 FROM public.orders) OR EXISTS (SELECT 1 FROM public.process_history)
     OR EXISTS (SELECT 1 FROM public.customers) THEN
    RAISE EXCEPTION 'Data order masih tersisa. Reset dibatalkan.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles) OR NOT EXISTS (SELECT 1 FROM public.production_steps) THEN
    RAISE EXCEPTION 'Akun atau tahapan produksi hilang. Reset dibatalkan.';
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM public.orders)           AS total_order,
  (SELECT count(*) FROM public.customers)        AS total_customer,
  (SELECT count(*) FROM public.process_history)  AS total_riwayat,
  (SELECT count(*) FROM public.profiles)         AS akun_tersimpan,
  (SELECT count(*) FROM public.production_machines WHERE removed_at IS NULL) AS mesin_tersimpan;
