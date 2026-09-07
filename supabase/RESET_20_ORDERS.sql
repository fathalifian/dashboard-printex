-- MANUAL ONLY: replaces ALL orders and their process/archive history.
-- Run in Supabase SQL Editor after migrations 0001-0008 / SETUP_ONLINE.sql.
-- Accounts, customer directory, production stages and machines are preserved.
-- Each execution replaces the previous orders again. Not a deployment migration.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.printex_online_status()') IS NULL THEN
    RAISE EXCEPTION 'Jalankan SETUP_ONLINE.sql terlebih dahulu.';
  END IF;
END $$;

TRUNCATE TABLE public.schedule_items, public.order_step_events,
  public.order_activities, public.process_history, public.orders;

DO $$
DECLARE
  item record;
  customer_uuid uuid;
  today_wib date := (statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    (1, 'Nusantara Apparel', 'Sublim', 32, 'priority', 'Motif geometris biru'),
    (2, 'Pelangi Kreatif', 'DTF', 12, 'regular', 'Logo komunitas'),
    (3, 'Surya Event', 'Umbul-umbul', 40, 'regular', 'Promosi pembukaan toko'),
    (4, 'Sekar Busana', 'Batik', 28, 'priority', 'Motif bunga cokelat'),
    (5, 'Garuda Futsal', 'Jersey', 24, 'regular', 'Seragam tim merah'),
    (6, 'Arunika Fashion', 'Sublim', 18, 'regular', 'Motif pastel'),
    (7, 'Karya Mandiri', 'DTF', 9, 'priority', 'Logo usaha putih'),
    (8, 'Cakrawala Expo', 'Umbul-umbul', 55, 'regular', 'Acara pameran'),
    (9, 'Puspa Batik', 'Batik', 36, 'regular', 'Motif daun hijau'),
    (10, 'Rajawali Sport', 'Jersey', 30, 'priority', 'Seragam tandang hitam'),
    (11, 'Mentari Textile', 'Sublim', 45, 'regular', 'Motif abstrak oranye'),
    (12, 'Kopi Senja', 'DTF', 8, 'regular', 'Kaos staf kedai'),
    (13, 'Bumi Festival', 'Umbul-umbul', 60, 'priority', 'Festival budaya'),
    (14, 'Laras Konveksi', 'Batik', 22, 'regular', 'Seragam kantor'),
    (15, 'Bintang Basket', 'Jersey', 27, 'regular', 'Seragam biru putih'),
    (16, 'Ombak Studio', 'Sublim', 33, 'priority', 'Motif laut'),
    (17, 'Ruang Komunitas', 'DTF', 15, 'regular', 'Kaos kegiatan sosial'),
    (18, 'Prima Dekorasi', 'Umbul-umbul', 48, 'regular', 'Dekorasi peresmian'),
    (19, 'Canting Nusantara', 'Batik', 42, 'priority', 'Motif klasik merah'),
    (20, 'Elang Running', 'Jersey', 21, 'regular', 'Jersey lari hijau')
  ) AS seeds(n, customer_name, production_type, meter, customer_type, notes)
  LOOP
    SELECT id INTO customer_uuid FROM public.customers
      WHERE name=item.customer_name ORDER BY created_at, id LIMIT 1;
    IF customer_uuid IS NULL THEN
      INSERT INTO public.customers(name) VALUES(item.customer_name) RETURNING id INTO customer_uuid;
    END IF;
    INSERT INTO public.orders(spk_code, customer_id, production_type, meter,
      customer_type, order_date, due_at, notes, source)
    VALUES('SPK-' || nextval('public.printex_spk_seq'), customer_uuid,
      item.production_type, item.meter, item.customer_type,
      today_wib, today_wib + 1 + (item.n % 5), item.notes, 'manual');
  END LOOP;
END $$;
COMMIT;

SELECT count(*) AS total_order, count(DISTINCT production_type) AS jenis_produksi
FROM public.orders;
