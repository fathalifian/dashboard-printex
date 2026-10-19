-- LANGKAH 2 (OPSIONAL) — DATA UJI 7 HARI TERAKHIR (PRINTEX)
-- Jalankan di Supabase SQL Editor setelah langkah 1 (1_RESET_STRUKTUR_DATABASE.sql).
-- Seluruh pekerjaan ada dalam SATU blok: semua berhasil, atau tidak ada yang berubah.
-- Aman dijalankan ulang: setiap kali, semua order dikosongkan lalu diisi dari awal.
--
-- 1. MENGHAPUS PERMANEN seluruh data order: order, customer, riwayat proses, catatan
--    Mulai/Selesai cetak, jam operator per hari, laporan, antrean foto, log sinkronisasi.
--    TIDAK DIUBAH: akun, mesin, waktu kerja, operator standar, link stok, Customer Service.
-- 2. Membuat order uji 7 hari terakhir (hari ini termasuk) dengan mesin yang terdaftar
--    (Pusat Admin → Mesin), meniru data catatan cetak asli:
--    - Ukuran order: banyak order kecil (<1 m dan 1–3 m), sebagian 3–36 m, sesekali 50–100 m.
--    - Waktu aktif per order = SPK/editing (±50% order) + RIP + pasang roll (sesekali) + printing
--      (±130 m/jam) + potong roll (sesekali). Di antara order ada jeda/idle (sesekali lama).
--    - Order siap cetak datang sepanjang hari dan dikerjakan berurutan per mesin.
--    - Lini Sublim: Fedar -> Press (satu antrean Press untuk semua Fedar, bisa menumpuk).
--    - DTF berdiri sendiri; sebagian DTF di-press di lini press DTF sendiri. Press DTF itu
--      TIDAK dicatat dan TIDAK dihitung di stasiun Press dashboard.
--    - Kesibukan berbeda tiap hari; ada order baru, sedang desain, menunggu pembayaran,
--      antre cetak, terlambat, prioritas, selesai, dan diambil customer.
--    Semua order uji bertanda source='simulation' dan SPK 'UJI-...'. Hapus dengan langkah 3.
--
-- File foto di Storage tidak dihapus lewat SQL; kosongkan bucket "order-photos" dari menu
-- Storage bila perlu. Semua pengguna perlu memuat ulang (refresh) halaman setelah ini.

DO $$
DECLARE
 today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
 cutoff timestamptz := now() - interval '1 minute';
 -- Kesibukan per hari (6 hari lalu .. hari ini): pengali jumlah order harian.
 busy numeric[] := ARRAY[0.6, 1.3, 0.8, 1.8, 1.1, 0.7, 1.0];
 names text[] := ARRAY['Bu Nisa','Pak Arif','Bu Rina','Mas Dimas','Mbak Ayu','Pak Hendra','Bu Wulan','Mas Bayu',
  'Mbak Sari','Pak Fajar','Bu Ratna','Mas Reza','CV Sinar Jaya','Toko Berkah','SMA Bina Bangsa','Komunitas Gowes'];
 sublim_types text[] := ARRAY['Sublim','Sublim','Jersey','Jersey','Batik','Umbul-umbul'];
 m record; d integer; k integer; idx integer; cnt integer; rnd numeric;
 day_date date; free_at timestamptz; start_at timestamptz; len interval; ready timestamptz; readies timestamptz[];
 -- Mencari waktu mulai yang muat dalam blok kerja mesin.
 t timestamptz; fd date; s1 timestamptz; e1 timestamptz; s2 timestamptz; e2 timestamptz;
 factor numeric; speed numeric; meters numeric; width numeric; prod_type text; first_fedar uuid; press_machine uuid;
 -- Daftar pekerjaan cetak (satu indeks = satu order).
 j_machine uuid[]; j_kind text[]; j_type text[]; j_meter numeric[]; j_width numeric[]; j_ready timestamptz[];
 j_ps timestamptz[]; j_pe timestamptz[]; j_qs timestamptz[]; j_qe timestamptz[]; j_ds timestamptz[]; j_de timestamptz[];
 customer_ids uuid[]; cidx integer; oid uuid; spk text; seq integer := 0;
 stages text[]; times timestamptz[]; reached integer; done_at timestamptz; finalized timestamptz; entry timestamptz;
 t1 timestamptz; t2 timestamptz; t3 timestamptz; prio boolean; order_day date;
 step_ids jsonb;
BEGIN
 -- ===== Pemeriksaan =====
 -- Struktur lama (masih punya tabel order_step_events) harus dibangun ulang dulu.
 IF to_regclass('public.production_machines') IS NULL OR to_regclass('public.order_step_events') IS NOT NULL THEN
  RAISE EXCEPTION 'Jalankan 1_RESET_STRUKTUR_DATABASE.sql terlebih dahulu.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.production_machines WHERE kind='fedar' AND removed_at IS NULL)
  OR NOT EXISTS (SELECT 1 FROM public.production_machines WHERE kind='press' AND removed_at IS NULL) THEN
  RAISE EXCEPTION 'Daftarkan minimal satu mesin Fedar dan satu Press di Pusat Admin → Mesin.';
 END IF;

 -- ===== 1. Hapus semua data =====
 TRUNCATE TABLE public.orders, public.customers, public.process_history, public.print_runs, public.operator_shifts,
  public.order_photo_cleanup, public.photo_cleanup_requests, public.report_contributions, public.report_daily_summaries,
  public.report_order_payloads, public.report_refresh_queue, public.printex_row_changes;
 ALTER SEQUENCE public.printex_spk_seq RESTART;

 -- ===== 2. Order uji 7 hari =====
 -- Lewati trigger jam-sekarang agar riwayat bisa memakai waktu lampau (hanya di transaksi ini).
 PERFORM set_config('printex.importing','yes',true);
 PERFORM setseed(0.2026);
 SELECT jsonb_object_agg(code,id) INTO step_ids FROM public.production_steps;
 BEGIN
  factor := 1;
  SELECT id INTO first_fedar FROM public.production_machines WHERE removed_at IS NULL AND kind='fedar' ORDER BY name LIMIT 1;
  SELECT id INTO press_machine FROM public.production_machines WHERE removed_at IS NULL AND kind='press' ORDER BY name LIMIT 1;
  j_machine := '{}'; j_kind := '{}'; j_type := '{}'; j_meter := '{}'; j_width := '{}'; j_ready := '{}';
  j_ps := '{}'; j_pe := '{}'; j_qs := '{}'; j_qe := '{}'; j_ds := '{}'; j_de := '{}';

  -- Cetak: order siap cetak datang sepanjang hari; tiap mesin mengerjakannya berurutan.
  FOR m IN SELECT * FROM public.production_machines WHERE removed_at IS NULL AND kind IN ('fedar','dtf') ORDER BY kind,name LOOP
   free_at := ((today-6) + time '08:30') AT TIME ZONE 'Asia/Jakarta';
   FOR d IN 0..6 LOOP
    day_date := today-6+d;
    cnt := greatest(1, round(busy[d+1] * CASE WHEN m.kind='dtf' THEN 12 ELSE 22 END * (0.85+random()*0.3))::integer);
    SELECT array_agg(x ORDER BY x) INTO readies FROM (
     SELECT ((day_date + time '08:00') AT TIME ZONE 'Asia/Jakarta') + make_interval(secs=>floor(random()*30600)::integer) AS x
     FROM generate_series(1,cnt)) r;
    FOREACH ready IN ARRAY readies LOOP
     CONTINUE WHEN ready > cutoff;
     rnd := random();
     IF m.kind='dtf' THEN
      prod_type := 'DTF'; width := 0.6;
      meters := round((CASE WHEN rnd<0.40 THEN 0.3+random()*0.7 WHEN rnd<0.75 THEN 1+random()*2 WHEN rnd<0.95 THEN 3+random()*5 ELSE 8+random()*7 END)::numeric,2);
      speed := factor * 15;
     ELSE
      prod_type := sublim_types[1+floor(random()*array_length(sublim_types,1))::integer];
      width := (ARRAY[1.2,1.6,1.6,1.8])[1+floor(random()*4)::integer];
      -- Sebaran ukuran seperti catatan asli.
      meters := round((CASE WHEN rnd<0.28 THEN 0.3+random()*0.7 WHEN rnd<0.50 THEN 1+random()*2 WHEN rnd<0.66 THEN 3+random()*5
        WHEN rnd<0.85 THEN 8+random()*8 WHEN rnd<0.95 THEN 16+random()*20 ELSE 50+random()*50 END)::numeric,2);
      speed := factor * CASE WHEN m.id=first_fedar THEN 135 ELSE 115 END * CASE width WHEN 1.2 THEN 1.08 WHEN 1.8 THEN 0.93 ELSE 1 END;
     END IF;
     -- Waktu aktif = SPK/editing + RIP + pasang roll + printing + potong roll (detik).
     len := make_interval(secs=>round(
       CASE WHEN random()<0.5 THEN 20+random()*250 ELSE 0 END
      + 9 + power(random(),2)*290
      + CASE WHEN random()<0.45 THEN CASE WHEN random()<0.08 THEN 600+random()*400 ELSE 40+random()*60 END ELSE 0 END
      + 15 + meters/speed*3600*(0.92+random()*0.16)
      + CASE WHEN random()<0.45 THEN 26+random()*80 ELSE 0 END));
     -- Waktu mulai paling awal yang muat di 08:30–12:00 atau 13:30–17:00 WIB.
     t := greatest(ready, free_at);
     FOR guard IN 1..60 LOOP
      fd := (t AT TIME ZONE 'Asia/Jakarta')::date;
      s1 := (fd + time '08:30') AT TIME ZONE 'Asia/Jakarta'; e1 := (fd + time '12:00') AT TIME ZONE 'Asia/Jakarta';
      s2 := (fd + time '13:30') AT TIME ZONE 'Asia/Jakarta'; e2 := (fd + time '17:00') AT TIME ZONE 'Asia/Jakarta';
      IF t < s1 THEN t := s1; END IF;
      EXIT WHEN t < e1 AND t + len <= e1;
      IF t < s2 THEN t := s2; END IF;
      EXIT WHEN t < e2 AND t + len <= e2;
      t := (fd + 1 + time '08:30') AT TIME ZONE 'Asia/Jakarta';
     END LOOP;
     j_machine := j_machine||m.id; j_kind := j_kind||m.kind::text; j_type := j_type||prod_type;
     j_meter := j_meter||meters; j_width := j_width||width; j_ready := j_ready||ready;
     j_qs := j_qs||NULL::timestamptz; j_qe := j_qe||NULL::timestamptz; j_ds := j_ds||NULL::timestamptz; j_de := j_de||NULL::timestamptz;
     IF t > cutoff THEN
      -- Belum mulai dicetak: antre di Proses Sublim.
      j_ps := j_ps||NULL::timestamptz; j_pe := j_pe||NULL::timestamptz;
     ELSE
      j_ps := j_ps||t; j_pe := j_pe||(t+len);
      -- Jeda ke order berikutnya; sesekali idle lama (nunggu operator, set up, sample).
      rnd := random();
      free_at := t + len + make_interval(secs=>round(CASE WHEN rnd<0.03 THEN 1500+random()*1500 WHEN rnd<0.15 THEN 100+random()*500 ELSE 30+random()*90 END));
     END IF;
    END LOOP;
   END LOOP;
  END LOOP;

  -- Press Sublim: satu antrean untuk hasil kedua Fedar, sesuai urutan selesai cetak.
  free_at := ((today-6) + time '08:30') AT TIME ZONE 'Asia/Jakarta';
  FOR idx IN SELECT u.i FROM unnest(j_pe, j_kind) WITH ORDINALITY AS u(e,kd,i) WHERE u.kd='fedar' AND u.e <= cutoff ORDER BY u.e LOOP
   len := make_interval(secs=>round(30+random()*60 + j_meter[idx]/(factor*85*(0.9+random()*0.2))*3600));   -- setup + press
   t := greatest(j_pe[idx], free_at);
   FOR guard IN 1..60 LOOP
    fd := (t AT TIME ZONE 'Asia/Jakarta')::date;
    s1 := (fd + time '08:30') AT TIME ZONE 'Asia/Jakarta'; e1 := (fd + time '12:00') AT TIME ZONE 'Asia/Jakarta';
    s2 := (fd + time '13:30') AT TIME ZONE 'Asia/Jakarta'; e2 := (fd + time '17:00') AT TIME ZONE 'Asia/Jakarta';
    IF t < s1 THEN t := s1; END IF;
    EXIT WHEN t < e1 AND t + len <= e1;
    IF t < s2 THEN t := s2; END IF;
    EXIT WHEN t < e2 AND t + len <= e2;
    t := (fd + 1 + time '08:30') AT TIME ZONE 'Asia/Jakarta';
   END LOOP;
   EXIT WHEN t > cutoff;
   j_qs[idx] := t;
   j_qe[idx] := CASE WHEN t+len <= cutoff THEN t+len END;
   free_at := t + len + make_interval(secs=>round(30+random()*90));
  END LOOP;
  -- Sebagian DTF di-press di lini press DTF sendiri (tidak dicatat, tidak masuk dashboard).
  FOR idx IN SELECT u.i FROM unnest(j_pe, j_kind) WITH ORDINALITY AS u(e,kd,i) WHERE u.kd='dtf' AND u.e <= cutoff LOOP
   CONTINUE WHEN random() >= 0.4;
   j_ds[idx] := j_pe[idx] + make_interval(mins=>5+floor(random()*25)::integer);
   j_de[idx] := j_ds[idx] + make_interval(mins=>3+floor(random()*12)::integer);
  END LOOP;

  customer_ids := ARRAY[]::uuid[];
  FOR k IN 1..array_length(names,1) LOOP
   oid := gen_random_uuid();
   INSERT INTO public.customers(id,name,phone,created_at,updated_at)
   VALUES(oid,names[k],'0812'||lpad((abs(hashtext(names[k])) % 100000000)::text,8,'0'),
    ((today-6)+time '07:00') AT TIME ZONE 'Asia/Jakarta',((today-6)+time '07:00') AT TIME ZONE 'Asia/Jakarta');
   customer_ids := customer_ids||oid;
  END LOOP;

  -- Order dari setiap pekerjaan cetak, urut waktu siap cetak.
  FOR idx IN SELECT u.i FROM unnest(j_ready) WITH ORDINALITY AS u(s,i) ORDER BY u.s LOOP
   ready := j_ready[idx];
   -- Desain lalu menunggu pembayaran, beberapa jam sebelum siap cetak.
   t3 := ready - make_interval(mins=>10+floor(random()*110)::integer);
   t2 := t3 - make_interval(mins=>15+floor(random()*50)::integer);   -- lama desain 15–65 menit
   t1 := t2 - make_interval(mins=>5+floor(random()*85)::integer);
   IF t1 < (((ready AT TIME ZONE 'Asia/Jakarta')::date) + time '07:00') AT TIME ZONE 'Asia/Jakarta' THEN
    IF (ready AT TIME ZONE 'Asia/Jakarta')::date > today-6 THEN
     -- Order pagi: masuk dan didesain kemarin sore.
     t3 := ((((ready AT TIME ZONE 'Asia/Jakarta')::date - 1) + time '15:00') AT TIME ZONE 'Asia/Jakarta') + make_interval(mins=>floor(random()*100)::integer);
     t2 := t3 - make_interval(mins=>15+floor(random()*50)::integer);
     t1 := t2 - make_interval(mins=>5+floor(random()*85)::integer);
    ELSE
     -- Hari pertama tidak punya "kemarin" dalam 7 hari: mulai pukul 07:00.
     t1 := ((today-6 + time '07:00') AT TIME ZONE 'Asia/Jakarta') + make_interval(mins=>floor(random()*20)::integer);
     t2 := t1 + make_interval(mins=>5+floor(random()*10)::integer);
     t3 := t2 + make_interval(mins=>15+floor(random()*15)::integer);
    END IF;
   END IF;
   -- Masuk Proses Sublim/DTF saat mulai cetak; yang belum mulai antre sejak siap cetak.
   entry := greatest(coalesce(j_ps[idx], ready), t3 + interval '1 minute');
   prio := random() < 0.15;
   order_day := (t1 AT TIME ZONE 'Asia/Jakarta')::date;
   stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING'];
   times := ARRAY[t1,t2,t3,entry];
   IF j_kind[idx]='fedar' THEN
    stages := stages||'PRESS'::text; times := times||coalesce(j_pe[idx],'infinity');   -- antre di Proses Press
    done_at := coalesce(j_qe[idx],'infinity');
   ELSIF j_ds[idx] IS NOT NULL THEN
    stages := stages||'PRESS'::text; times := times||j_pe[idx];                         -- press DTF (lini sendiri)
    done_at := j_de[idx];
   ELSE
    done_at := coalesce(j_pe[idx],'infinity');
   END IF;
   stages := stages||'DONE'::text; times := times||done_at;
   -- Diambil customer: sebagian besar order kemarin dan sebelumnya, sebagian kecil hari ini.
   finalized := NULL;
   IF done_at < cutoff AND random() < (CASE WHEN (done_at AT TIME ZONE 'Asia/Jakarta')::date < today THEN 0.85 ELSE 0.3 END) THEN
    finalized := done_at + make_interval(mins=>30+floor(random()*1200)::integer);
    IF finalized <= cutoff THEN stages := stages||'ARCHIVE'::text; times := times||finalized; ELSE finalized := NULL; END IF;
   END IF;
   reached := 0;
   FOR k IN 1..array_length(times,1) LOOP EXIT WHEN times[k] > cutoff; reached := k; END LOOP;
   seq := seq+1; oid := gen_random_uuid(); cidx := 1+floor(random()*array_length(customer_ids,1))::integer;
   spk := 'UJI-'||to_char(order_day,'DDMM')||'-'||lpad(seq::text,4,'0');
   INSERT INTO public.orders(id,spk_code,customer_id,production_type,meter,paper_width,customer_type,order_state,
    current_step_id,order_date,due_at,archived_at,archive_finalized_at,delivery_method,notes,source,
    created_at,updated_at,print_machine_id)
   VALUES(oid,spk,customer_ids[cidx],j_type[idx],j_meter[idx],j_width[idx],CASE WHEN prio THEN 'priority' ELSE 'regular' END,
    CASE WHEN stages[reached] IN ('DONE','ARCHIVE') THEN 'completed' ELSE 'active' END,
    (step_ids->>stages[reached])::uuid,order_day,order_day+CASE WHEN prio THEN 1 ELSE 2+floor(random()*2)::integer END,
    CASE WHEN stages[reached]='ARCHIVE' THEN finalized END, CASE WHEN stages[reached]='ARCHIVE' THEN finalized END,
    CASE WHEN stages[reached]='ARCHIVE' THEN 'received' END,
    '[DATA UJI] Order rekayasa untuk menguji dashboard','simulation',t1,times[reached],j_machine[idx]);
   INSERT INTO public.process_history(order_id,order_identity,spk_code,step_id,event_kind,customer_name,occurred_at)
   VALUES(oid,oid::text,spk,(step_ids->>'ORDER_IN')::uuid,'entered',names[cidx],t1);
   FOR k IN 2..reached LOOP
    INSERT INTO public.process_history(order_id,order_identity,spk_code,step_id,event_kind,customer_name,next_step_id,next_event_id,occurred_at)
    VALUES(oid,oid::text,spk,(step_ids->>stages[k-1])::uuid,'completed',names[cidx],(step_ids->>stages[k])::uuid,gen_random_uuid(),times[k]);
   END LOOP;
   -- Mulai/Selesai cetak (masih terbuka bila mesin sedang mencetak sekarang).
   IF j_ps[idx] IS NOT NULL THEN
    INSERT INTO public.print_runs(order_id,machine_id,stage,started_at,ended_at)
    VALUES(oid,j_machine[idx],'printing',j_ps[idx],CASE WHEN j_pe[idx] <= cutoff THEN j_pe[idx] END);
   END IF;
   -- Mulai/Selesai press hanya untuk lini Sublim.
   IF j_kind[idx]='fedar' AND j_qs[idx] IS NOT NULL THEN
    INSERT INTO public.print_runs(order_id,machine_id,stage,started_at,ended_at)
    VALUES(oid,press_machine,'press',j_qs[idx],j_qe[idx]);
   END IF;
  END LOOP;

  -- Order yang belum sampai cetak: baru masuk, sedang desain, dan menunggu pembayaran
  -- (sebagian sudah lewat tenggat = terlambat).
  FOR k IN 1..9 LOOP
   prod_type := CASE WHEN k % 3 = 0 THEN 'DTF' ELSE sublim_types[1+floor(random()*array_length(sublim_types,1))::integer] END;
   meters := round((CASE WHEN prod_type='DTF' THEN 0.5+random()*5 WHEN random()<0.5 THEN 0.5+random()*3 ELSE 3+random()*25 END)::numeric,2);
   width := CASE WHEN prod_type='DTF' THEN 0.6 ELSE (ARRAY[1.2,1.6,1.8])[1+floor(random()*3)::integer] END;
   IF k <= 2 THEN        -- baru masuk
    stages := ARRAY['ORDER_IN']; t1 := cutoff - make_interval(mins=>10+floor(random()*120)::integer); times := ARRAY[t1];
   ELSIF k <= 4 THEN     -- sedang desain
    t1 := cutoff - make_interval(mins=>90+floor(random()*120)::integer);
    stages := ARRAY['ORDER_IN','DESIGN']; times := ARRAY[t1, t1+make_interval(mins=>20+floor(random()*40)::integer)];
   ELSE                  -- menunggu pembayaran sejak 1–5 hari lalu
    t1 := ((today - (k-4)) + time '10:00') AT TIME ZONE 'Asia/Jakarta' + make_interval(mins=>floor(random()*240)::integer);
    stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE'];
    times := ARRAY[t1, t1+interval '30 minutes', t1+make_interval(mins=>60+floor(random()*60)::integer)];
   END IF;
   CONTINUE WHEN (t1 AT TIME ZONE 'Asia/Jakarta')::date < today-6;
   reached := 0;
   FOR d IN 1..array_length(times,1) LOOP EXIT WHEN times[d] > cutoff; reached := d; END LOOP;
   CONTINUE WHEN reached = 0;
   prio := k IN (3,6);
   order_day := (t1 AT TIME ZONE 'Asia/Jakarta')::date;
   seq := seq+1; oid := gen_random_uuid(); cidx := 1+floor(random()*array_length(customer_ids,1))::integer;
   spk := 'UJI-'||to_char(order_day,'DDMM')||'-'||lpad(seq::text,4,'0');
   INSERT INTO public.orders(id,spk_code,customer_id,production_type,meter,paper_width,customer_type,order_state,
    current_step_id,order_date,due_at,notes,source,created_at,updated_at)
   VALUES(oid,spk,customer_ids[cidx],prod_type,meters,width,CASE WHEN prio THEN 'priority' ELSE 'regular' END,'active',
    (step_ids->>stages[reached])::uuid,order_day,order_day+CASE WHEN prio THEN 1 ELSE 2 END,
    '[DATA UJI] Order rekayasa untuk menguji dashboard','simulation',t1,times[reached]);
   INSERT INTO public.process_history(order_id,order_identity,spk_code,step_id,event_kind,customer_name,occurred_at)
   VALUES(oid,oid::text,spk,(step_ids->>'ORDER_IN')::uuid,'entered',names[cidx],t1);
   FOR d IN 2..reached LOOP
    INSERT INTO public.process_history(order_id,order_identity,spk_code,step_id,event_kind,customer_name,next_step_id,next_event_id,occurred_at)
    VALUES(oid,oid::text,spk,(step_ids->>stages[d-1])::uuid,'completed',names[cidx],(step_ids->>stages[d])::uuid,gen_random_uuid(),times[d]);
   END LOOP;
  END LOOP;
 END;

 -- Bangun laporan harian sekarang, tanpa menunggu penjadwal.
 IF to_regprocedure('public.printex_refresh_report_order(uuid)') IS NOT NULL THEN
  PERFORM public.printex_refresh_report_order(id) FROM public.orders;
  DELETE FROM public.report_refresh_queue;
 END IF;
 -- Cursor sinkronisasi maju agar perangkat tidak memakai cursor lama.
 UPDATE public.printex_sync_clock SET revision = revision + 1 WHERE singleton;
 RAISE NOTICE 'Data uji selesai: % order.', (SELECT count(*) FROM public.orders);
END $$;

-- ===== Cek hasil: order per hari =====
SELECT o.order_date AS tanggal, count(*) AS order_masuk,
 round(sum(o.meter) FILTER (WHERE o.production_type<>'DTF'),1) AS meter_sublim,
 round(sum(o.meter) FILTER (WHERE o.production_type='DTF'),1) AS meter_dtf,
 count(*) FILTER (WHERE o.order_state='completed') AS selesai,
 count(*) FILTER (WHERE o.order_state='active' AND o.due_at < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS terlambat
FROM public.orders o GROUP BY o.order_date ORDER BY o.order_date;
