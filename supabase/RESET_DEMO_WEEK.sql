-- MANUAL DESTRUCTIVE RESET, explicitly requested by the project owner.
-- Run once in this project's Supabase SQL Editor as postgres.
-- Keeps Auth users, profiles, branches, settings, machines and production steps.
-- Replaces all operational records. Actual photos must be removed afterwards
-- with scripts/execute-demo-reset.mjs --cleanup-photos; never delete storage.objects via SQL.
-- Dates follow the execution date in Asia/Jakarta (today and six preceding days).
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public.orders, public.customers, public.process_history,
  public.order_step_events, public.order_activities, public.schedule_items,
  public.production_schedules IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE lower(name)='salatiga' AND is_active)
    THEN RAISE EXCEPTION 'Active Salatiga branch is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.branch_deletions)
    THEN RAISE EXCEPTION 'Finish pending branch deletions first'; END IF;
  IF (SELECT count(*) FROM public.production_steps WHERE code IN
    ('ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE','ARCHIVE')) <> 7
    THEN RAISE EXCEPTION 'Seven production stages are required'; END IF;
END $$;

-- DELETE preserves sync tombstones so devices discard the old records.
-- Archive protection is disabled only while holding the transaction lock.
ALTER TABLE public.orders DISABLE TRIGGER orders_enforce_archiving;
DELETE FROM public.schedule_items;
DELETE FROM public.production_schedules;
DELETE FROM public.order_step_events;
DELETE FROM public.order_activities;
DELETE FROM public.process_history;
DELETE FROM public.orders;
DELETE FROM public.customers;
ALTER TABLE public.orders ENABLE TRIGGER orders_enforce_archiving;
SET LOCAL printex.importing = 'yes';

-- Business-time clock: carry excess work into the next day, 08:00-18:00 WIB.
CREATE OR REPLACE FUNCTION pg_temp.demo_advance(t timestamptz, minutes integer)
RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE local_time timestamp := t AT TIME ZONE 'Asia/Jakarta'; available integer;
BEGIN
  LOOP
    IF local_time::time < time '08:00' THEN local_time := local_time::date + time '08:00'; END IF;
    IF local_time::time >= time '18:00' THEN local_time := local_time::date + 1 + time '08:00'; END IF;
    available := floor(extract(epoch FROM (local_time::date + time '18:00' - local_time))/60);
    IF minutes <= available THEN RETURN (local_time + make_interval(mins=>minutes)) AT TIME ZONE 'Asia/Jakarta'; END IF;
    minutes := minutes - available;
    local_time := local_time::date + 1 + time '08:00';
  END LOOP;
END $$;

SELECT setseed(0.29473);
DO $$
DECLARE
  b record; d integer; n integer; j integer; k integer; total integer; target integer;
  today date := (transaction_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  day_date date; arrival timestamptz; t timestamptz; next_t timestamptz;
  cutoff timestamptz := transaction_timestamp() - interval '1 minute';
  names text[] := ARRAY['Arunika Apparel','Garuda Sport','Sekar Konveksi','Kopi Senja',
    'Pelangi Kreatif','Bintang Futsal','Laras Busana','Prima Event','Mentari Textile',
    'Ruang Komunitas','Puspa Batik','Rajawali Running','Surya Advertising','Ombak Studio',
    'Nusa Jersey','Canting Karya','Tunas Mandiri','Cakrawala Expo'];
  notes text[] := ARRAY['Warna mengikuti sampel yang disetujui','Logo kecil di dada kiri',
    'Pesanan ulang motif sebelumnya','Kemasan dipisah per ukuran','Konfirmasi warna sebelum cetak',
    'Untuk acara komunitas akhir pekan','Motif geometris biru','Seragam tim merah hitam',
    'Cetak motif bunga pastel','Tambahan pesanan pelanggan tetap'];
  types text[] := ARRAY['Sublim','DTF','Jersey','Sublim','DTF','Batik','Umbul-umbul','Jersey'];
  customer_ids uuid[]; customer_names text[]; customer_idx integer;
  oid uuid; cid uuid; spk text; kind text; meters numeric; width numeric;
  stages text[]; times timestamptz[]; started timestamptz; completed timestamptz;
  archived timestamptz; finalized timestamptz; prefix text; duration integer;
BEGIN
  FOR b IN SELECT * FROM public.branches WHERE is_active ORDER BY name LOOP
    customer_ids := ARRAY[]::uuid[]; customer_names := ARRAY[]::text[];
    FOR j IN 1..array_length(names,1) LOOP
      cid := gen_random_uuid();
      INSERT INTO public.customers(id,name,branch_id,notes,created_at,updated_at)
        VALUES(cid,names[j]||' '||b.name,b.id,'DATA DUMMY - bukan pelanggan nyata',
          (today-6 + time '07:30') AT TIME ZONE 'Asia/Jakarta',
          (today-6 + time '07:30') AT TIME ZONE 'Asia/Jakarta');
      customer_ids := array_append(customer_ids,cid);
      customer_names := array_append(customer_names,names[j]||' '||b.name);
    END LOOP;
    prefix := CASE lower(b.name) WHEN 'salatiga' THEN 'SLT' WHEN 'semarang' THEN 'SMG'
      WHEN 'demak' THEN 'DMK' WHEN 'surabaya' THEN 'SBY' ELSE left(b.id::text,8) END;
    FOR d IN 0..6 LOOP
      day_date := today-6+d;
      total := CASE lower(b.name)
        WHEN 'salatiga' THEN (ARRAY[18,22,17,11,23,20,12])[d+1]
        WHEN 'semarang' THEN (ARRAY[10,12,9,6,11,10,6])[d+1]
        WHEN 'surabaya' THEN (ARRAY[7,9,8,4,10,8,5])[d+1]
        ELSE (ARRAY[5,7,6,3,8,6,4])[d+1] END;
      FOR n IN 1..total LOOP
        arrival := (day_date + time '08:00' + make_interval(mins=>floor(random()*540)::integer)) AT TIME ZONE 'Asia/Jakarta';
        IF d=6 THEN
          -- Today's arrivals are spread only across time that has already elapsed.
          arrival := (day_date + time '08:00') AT TIME ZONE 'Asia/Jakarta';
          IF arrival >= cutoff THEN CONTINUE; END IF;
          arrival := arrival + (least(cutoff, (day_date+time '17:00') AT TIME ZONE 'Asia/Jakarta')-arrival)*random();
        END IF;
        kind := types[1+floor(random()*array_length(types,1))::integer];
        meters := round((CASE kind WHEN 'DTF' THEN 3+random()*24
          WHEN 'Umbul-umbul' THEN 20+random()*65 WHEN 'Batik' THEN 16+random()*54
          WHEN 'Jersey' THEN 9+random()*34 ELSE 12+random()*60 END
          * CASE WHEN lower(b.name)='salatiga' THEN 1.3 ELSE 1 END)::numeric,1);
        width := CASE WHEN kind='DTF' THEN 0.6 ELSE (ARRAY[1.2,1.6,1.8])[1+floor(random()*3)::integer] END;
        customer_idx := 1+floor(random()*array_length(customer_ids,1))::integer;
        oid := gen_random_uuid(); spk := 'DUMMY-'||prefix||'-'||to_char(day_date,'YYMMDD')||'-'||lpad(n::text,3,'0');
        stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING'];
        IF kind<>'DTF' THEN stages := array_append(stages,'PRESS'); END IF;
        stages := stages||ARRAY['DONE','ARCHIVE'];
        target := array_length(stages,1);
        -- A few older orders remain waiting or in production; recent arrivals
        -- naturally stop at the latest stage they could have reached by now.
        IF random()<0.16 THEN target := 2+floor(random()*3)::integer; END IF;
        times := ARRAY[arrival]; t := arrival;
        FOR k IN 2..target LOOP
          duration := CASE stages[k-1]
            WHEN 'ORDER_IN' THEN 10+floor(random()*70)::integer
            WHEN 'DESIGN' THEN 35+floor(random()*190)::integer
            WHEN 'DESIGN_DONE' THEN 15+floor(random()*240)::integer
            WHEN 'PRINTING' THEN 25+ceil(meters*(1.0+random()*2))::integer
            WHEN 'PRESS' THEN 20+ceil(meters*(0.6+random()))::integer
            ELSE 30+floor(random()*420)::integer END;
          next_t := pg_temp.demo_advance(t,duration);
          EXIT WHEN next_t>cutoff;
          times := array_append(times,next_t); t := next_t;
        END LOOP;
        target := array_length(times,1);
        started := CASE WHEN target>=2 THEN times[2] END;
        completed := CASE WHEN array_position(stages,'DONE')<=target THEN times[array_position(stages,'DONE')] END;
        archived := CASE WHEN stages[target]='ARCHIVE' THEN times[target] END;
        finalized := NULL;
        IF archived IS NOT NULL AND random()<0.78 THEN
          next_t := pg_temp.demo_advance(archived,20+floor(random()*180)::integer);
          IF next_t<=cutoff THEN finalized := next_t; END IF;
        END IF;
        INSERT INTO public.orders(id,spk_code,customer_id,branch_id,production_type,meter,
          paper_width,customer_type,order_state,current_step_id,order_date,due_at,started_at,
          completed_at,archived_at,archive_finalized_at,delivery_method,notes,source,created_at,updated_at)
        VALUES(oid,spk,customer_ids[customer_idx],b.id,kind,meters,width,
          CASE WHEN random()<0.22 THEN 'priority' ELSE 'regular' END,
          CASE WHEN completed IS NULL THEN 'active' ELSE 'completed' END,
          (SELECT id FROM public.production_steps WHERE code=stages[target]),day_date,
          day_date+1+floor(random()*3)::integer,started,completed,archived,finalized,
          CASE WHEN archived IS NOT NULL THEN CASE WHEN random()<0.65 THEN 'pickup' ELSE 'delivery' END END,
          '[DATA DUMMY] '||notes[1+floor(random()*array_length(notes,1))::integer],
          'manual',arrival,coalesce(finalized,t));
        FOR k IN 1..target LOOP
          INSERT INTO public.process_history(order_id,order_identity,branch_id,spk_code,step_id,event_kind,occurred_at,actor_name,customer_name)
          VALUES(oid,oid::text,b.id,spk,(SELECT id FROM public.production_steps WHERE code=stages[k]),
            'entered',times[k],'Tim '||b.name||' (Dummy)',customer_names[customer_idx]);
          IF k<target THEN
            INSERT INTO public.process_history(order_id,order_identity,branch_id,spk_code,step_id,event_kind,occurred_at,actor_name,customer_name)
            VALUES(oid,oid::text,b.id,spk,(SELECT id FROM public.production_steps WHERE code=stages[k]),
              'completed',times[k+1],'Tim '||b.name||' (Dummy)',customer_names[customer_idx]);
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Abort the whole transaction if the requested ranking or timing is not met.
DO $$ DECLARE sal_orders bigint; sal_output numeric; BEGIN
  SELECT count(*),coalesce(sum(o.meter) FILTER(WHERE EXISTS(SELECT 1 FROM public.process_history h
    JOIN public.production_steps s ON s.id=h.step_id WHERE h.order_id=o.id AND s.code='PRINTING' AND h.event_kind='completed')),0)
    INTO sal_orders,sal_output FROM public.orders o JOIN public.branches b ON b.id=o.branch_id WHERE lower(b.name)='salatiga';
  IF EXISTS(SELECT 1 FROM public.orders o JOIN public.branches b ON b.id=o.branch_id WHERE lower(b.name)<>'salatiga'
    GROUP BY b.id HAVING count(*)>=sal_orders OR coalesce(sum(o.meter) FILTER(WHERE EXISTS(SELECT 1 FROM public.process_history h
      JOIN public.production_steps s ON s.id=h.step_id WHERE h.order_id=o.id AND s.code='PRINTING' AND h.event_kind='completed')),0)>=sal_output)
    THEN RAISE EXCEPTION 'Salatiga must have the highest order count and output'; END IF;
  IF EXISTS(SELECT 1 FROM public.process_history WHERE occurred_at>transaction_timestamp())
    THEN RAISE EXCEPTION 'Future process event'; END IF;
END $$;
COMMIT;

SELECT b.name AS cabang,count(o.id) AS total_order,
  count(o.id) FILTER(WHERE o.completed_at IS NOT NULL) AS order_selesai,
  count(o.id) FILTER(WHERE o.archive_finalized_at IS NOT NULL) AS arsip_final,
  coalesce(sum(o.meter) FILTER(WHERE EXISTS(SELECT 1 FROM public.process_history h JOIN public.production_steps s
    ON s.id=h.step_id WHERE h.order_id=o.id AND s.code='PRINTING' AND h.event_kind='completed')),0) AS output_meter
FROM public.branches b LEFT JOIN public.orders o ON o.branch_id=b.id GROUP BY b.id,b.name ORDER BY total_order DESC;
