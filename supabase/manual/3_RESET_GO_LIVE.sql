-- LANGKAH 3 (NANTI, SAAT MULAI DIPAKAI SUNGGUHAN) — RESET GO-LIVE PRINTEX
-- Menghapus SELURUH data order (termasuk data uji) secara permanen.
-- Jalankan sekali di Supabase SQL Editor, di luar jam kerja.
-- Seluruh pekerjaan ada dalam SATU blok: semua berhasil, atau tidak ada yang berubah.
--
-- DIHAPUS : order, customer, riwayat proses, catatan Mulai/Selesai cetak, jam operator per hari,
--           antrean foto, seluruh ringkasan & rincian laporan, log sinkronisasi.
-- DISIMPAN: akun login & profil, nomor Customer Service, link stok,
--           tahapan produksi, mesin, waktu kerja & operator standar.
--
-- File foto di Storage tidak dihapus lewat SQL. Setelah script ini berhasil,
-- kosongkan bucket "order-photos" dari menu Storage di dashboard Supabase.
-- Semua pengguna perlu memuat ulang (refresh) halaman setelah reset.

DO $$
BEGIN
  -- Struktur lama (masih punya tabel order_step_events) harus dibangun ulang dulu.
  IF to_regclass('public.production_machines') IS NULL OR to_regclass('public.order_step_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Jalankan 1_RESET_STRUKTUR_DATABASE.sql terlebih dahulu.';
  END IF;
  -- Tanpa CASCADE: bila ada tabel lain yang masih mereferensikan data ini, semuanya dibatalkan.
  TRUNCATE TABLE public.orders, public.customers, public.process_history, public.print_runs, public.operator_shifts,
    public.order_photo_cleanup, public.photo_cleanup_requests, public.report_contributions, public.report_daily_summaries,
    public.report_order_payloads, public.report_refresh_queue, public.printex_row_changes;
  -- Nomor SPK otomatis mulai lagi dari awal.
  ALTER SEQUENCE public.printex_spk_seq RESTART;
  -- Cursor sinkronisasi maju agar perangkat tidak memakai cursor lama.
  UPDATE public.printex_sync_clock SET revision = revision + 1 WHERE singleton;

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
