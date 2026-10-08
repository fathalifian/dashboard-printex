-- MANUAL DESTRUCTIVE RESET, explicitly requested by the project owner.
-- Run only through scripts/execute-demo-month.mjs, inside its backup/validation transaction.
-- Keeps Auth users, profiles, branches, settings, machines and production steps.
-- Replaces all operational records. Actual photos must be removed afterwards
-- through the Storage API; never delete storage.objects via SQL.
-- Simulation: 30 calendar days ending today, Asia/Jakarta. 900-1,500 orders/branch.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '600s';
LOCK TABLE public.orders, public.customers, public.process_history,
  public.order_step_events, public.order_activities, public.schedule_items,
  public.production_schedules IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE is_active) THEN RAISE EXCEPTION 'An active branch is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.branch_deletions)
    THEN RAISE EXCEPTION 'Finish pending branch deletions first'; END IF;
  IF (SELECT count(*) FROM public.production_steps WHERE code IN
    ('ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE','ARCHIVE')) <> 7
    THEN RAISE EXCEPTION 'Seven production stages are required'; END IF;
END $$;

-- One atomic reset needs one cursor revision, not one update to the clock per row.
-- The clock lock is held through commit; publish every old/new ID at that revision.
CREATE TEMP TABLE demo_sync_revision ON COMMIT DROP AS
  WITH clock AS (UPDATE public.printex_sync_clock SET revision=revision+1 WHERE singleton RETURNING revision)
  SELECT revision FROM clock;
ALTER TABLE public.orders DISABLE TRIGGER printex_track_change;
ALTER TABLE public.customers DISABLE TRIGGER printex_track_change;
ALTER TABLE public.process_history DISABLE TRIGGER printex_track_change;
INSERT INTO public.printex_row_changes(table_name,row_id,branch_key,revision,deleted)
SELECT name,id,branch_id::text,r.revision,true FROM (
 SELECT 'orders' AS name,id,branch_id FROM public.orders UNION ALL
 SELECT 'customers',id,branch_id FROM public.customers UNION ALL
 SELECT 'process_history',id,branch_id FROM public.process_history
) previous CROSS JOIN demo_sync_revision r
ON CONFLICT(table_name,row_id,branch_key) DO UPDATE SET revision=EXCLUDED.revision,deleted=true;

-- DELETE retains the tombstones above so devices discard the old records.
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
  scenario integer; scenario_name text; speed numeric; actor uuid; actor_label text; due date;
  month_target integer; allocated integer; weights numeric[]; weight_total numeric; cumulative numeric; weight numeric;
  file_title text; fabric text; item_name text;
  names text[] := ARRAY['Bu Nisa','Pak Arif','Bu Rina','Mas Dimas','Mbak Ayu','Pak Hendra',
    'Bu Wulan','Mas Bayu','Mbak Sari','Pak Fajar','Bu Ratna','Mas Reza','Mbak Intan',
    'Pak Aditya','Bu Melati','Mas Yoga','Mbak Anisa','Pak Deni','Bu Laras','Mas Galih',
    'Mbak Citra','Pak Bagas','Bu Kartika','Mas Ilham','Mbak Tika','Pak Yudi',
    'Bu Indah','Mas Rizal','Mbak Putri','Pak Surya'];
  notes text[] := ARRAY['Warna mengikuti sampel yang disetujui','Logo kecil di dada kiri',
    'Pesanan ulang motif sebelumnya','Kemasan dipisah per ukuran','Konfirmasi warna sebelum cetak',
    'Untuk acara komunitas akhir pekan','Motif geometris biru','Seragam tim merah hitam',
    'Cetak motif bunga pastel','Tambahan pesanan pelanggan tetap'];
  types text[] := ARRAY['Sublim','DTF','Jersey','Sublim','DTF','Batik','Umbul-umbul','Jersey'];
  customer_ids uuid[]; customer_names text[]; customer_idx integer;
  oid uuid; cid uuid; spk text; kind text; meters numeric; width numeric;
  stages text[]; times timestamptz[]; started timestamptz; completed timestamptz;
  archived timestamptz; finalized timestamptz; duration integer;
BEGIN
  FOR b IN SELECT * FROM public.branches WHERE is_active ORDER BY name LOOP
    customer_ids := ARRAY[]::uuid[]; customer_names := ARRAY[]::text[];
    FOR j IN 1..array_length(names,1) LOOP
      cid := gen_random_uuid();
      INSERT INTO public.customers(id,name,branch_id,notes,created_at,updated_at)
        VALUES(cid,names[j],b.id,'Data simulasi pelanggan untuk pengujian sistem',
          (today-29 + time '07:30') AT TIME ZONE 'Asia/Jakarta',
          (today-29 + time '07:30') AT TIME ZONE 'Asia/Jakarta');
      customer_ids := array_append(customer_ids,cid);
      customer_names := array_append(customer_names,names[j]);
    END LOOP;
    month_target := CASE lower(trim(b.name)) WHEN 'demak' THEN 1290 WHEN 'salatiga' THEN 1500
      WHEN 'gunung jati' THEN 900 WHEN 'jombang' THEN 960 WHEN 'kartasura' THEN 1080
      WHEN 'kediri' THEN 1020 WHEN 'klaten' THEN 1140 WHEN 'pekalongan' THEN 1200
      WHEN 'saladua' THEN 930 WHEN 'solo' THEN 1260
      WHEN 'semarang' THEN 1380 WHEN 'surabaya' THEN 1350 ELSE 1100 END;
    weights := ARRAY[]::numeric[]; weight_total:=0; cumulative:=0; allocated:=0;
    FOR d IN 0..29 LOOP
      weight := (1+(((d*7)%5)-2)*0.07) * CASE WHEN extract(isodow FROM today-29+d)=7 THEN 0.72 ELSE 1 END;
      IF d=29 THEN weight := weight*greatest(0,least(1,extract(epoch FROM(cutoff-((today+time '08:00') AT TIME ZONE 'Asia/Jakarta')))/36000)); END IF;
      weights := array_append(weights,weight); weight_total:=weight_total+weight;
    END LOOP;
    FOR d IN 0..29 LOOP
      day_date := today-29+d;
      cumulative := cumulative+weights[d+1];
      total := CASE WHEN d=29 THEN month_target ELSE floor(month_target*cumulative/weight_total)::integer END-allocated;
      allocated := allocated+total;
      FOR n IN 1..total LOOP
        arrival := (day_date + time '08:00' + make_interval(mins=>floor(random()*540)::integer)) AT TIME ZONE 'Asia/Jakarta';
        IF d=29 THEN
          -- Today's arrivals are spread only across time that has already elapsed.
          arrival := (day_date + time '08:00') AT TIME ZONE 'Asia/Jakarta';
          IF arrival >= cutoff THEN CONTINUE; END IF;
          arrival := arrival + (least(cutoff, (day_date+time '17:00') AT TIME ZONE 'Asia/Jakarta')-arrival)*random();
        END IF;
        scenario := (n+d)%10;
        scenario_name := (ARRAY['Cepat','Normal','Normal','Terlambat selesai','Revisi desain','Revisi cetak','Prioritas cepat','Menunggu pembayaran','Antrean produksi','Normal'])[scenario+1];
        speed := (ARRAY[0.3,1.0,1.2,5.5,1.4,1.5,0.4,2.0,2.5,0.8])[scenario+1];
        kind := types[1+((n+d)%array_length(types,1))];
        IF d=29 AND n<=7 THEN
          kind := 'Sublim'; scenario_name := 'Uji tahap aktif '||n; speed := 0.15;
          arrival := (day_date+time '08:00') AT TIME ZONE 'Asia/Jakarta';
          IF arrival>=cutoff THEN CONTINUE; END IF;
        END IF;
        due := day_date + CASE WHEN scenario=3 THEN 1 WHEN scenario IN (0,6) THEN 2 ELSE 3 END;
        SELECT id,full_name INTO actor,actor_label FROM public.profiles WHERE is_active
          AND (branch_id=b.id OR role='central_owner') ORDER BY (branch_id=b.id) DESC NULLS LAST,id LIMIT 1;
        meters := round((CASE kind WHEN 'DTF' THEN 3+random()*24
          WHEN 'Umbul-umbul' THEN 20+random()*65 WHEN 'Batik' THEN 16+random()*54
          WHEN 'Jersey' THEN 9+random()*34 ELSE 12+random()*60 END
          * CASE WHEN lower(b.name)='salatiga' THEN 1.3 ELSE 1 END)::numeric,1);
        width := CASE WHEN kind='DTF' THEN 0.6 ELSE (ARRAY[1.2,1.6,1.8])[1+floor(random()*3)::integer] END;
        customer_idx := 1+floor(random()*array_length(customer_ids,1))::integer;
        oid := gen_random_uuid();
        LOOP
          spk := 'PTXID'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
          EXIT WHEN NOT EXISTS(SELECT 1 FROM public.orders WHERE spk_code=spk);
        END LOOP;
        fabric := CASE WHEN kind='DTF' THEN 'TRANSFER FILM DTF' ELSE (ARRAY['MILANO DELUXE','DRIFIT PREMIUM','MICROFIBER','JERSEY HEXAGON'])[1+(n+d)%4] END;
        item_name := CASE kind WHEN 'DTF' THEN 'LOGO KAOS KOMUNITAS' WHEN 'Batik' THEN 'MOTIF BATIK SERAGAM'
          WHEN 'Umbul-umbul' THEN 'UMBUL UMBUL ACARA' ELSE (ARRAY['JERSEY GARUDA','SERAGAM KOMUNITAS','JERSEY FUTSAL','JERSEY LARI'])[1+(n+d)%4] END;
        file_title := CASE WHEN kind='DTF' THEN 'DTF.' ELSE 'SUB.' END||to_char(day_date,'DDMMYY')||'.'||(allocated-total+n)::text||'.'||upper(customer_names[customer_idx])||' - '||item_name||'.cdr';
        stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING'];
        IF scenario=4 AND NOT(d=29 AND n<=7) THEN
          stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE','DESIGN','DESIGN_DONE','PRINTING'];
        ELSIF scenario=5 AND kind<>'DTF' AND NOT(d=29 AND n<=7) THEN
          stages := ARRAY['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','PRESS','PRINTING'];
        END IF;
        IF kind<>'DTF' THEN stages := array_append(stages,'PRESS'); END IF;
        stages := stages||ARRAY['DONE','ARCHIVE'];
        target := array_length(stages,1);
        -- A few older orders remain waiting or in production; recent arrivals
        -- naturally stop at the latest stage they could have reached by now.
        IF (d>=26 AND scenario IN (7,8)) OR (n=1 AND d%7=0) THEN
          target := CASE WHEN scenario=7 THEN 3 ELSE 4 END;
          scenario_name := CASE WHEN due < today THEN 'Tertahan melewati tenggat' ELSE 'Antrean belum jatuh tempo' END;
        END IF;
        IF d=29 AND n<=7 THEN target:=n; END IF;
        times := ARRAY[arrival]; t := arrival;
        FOR k IN 2..target LOOP
          duration := CASE stages[k-1]
            WHEN 'ORDER_IN' THEN 5+floor(random()*45)::integer
            WHEN 'DESIGN' THEN 5+floor(random()*30)::integer
            WHEN 'DESIGN_DONE' THEN 10+floor(random()*90)::integer
            WHEN 'PRINTING' THEN ceil(5+meters*(0.4+random()*0.2))::integer
            WHEN 'PRESS' THEN ceil(3+meters*(0.25+random()*0.15))::integer
            ELSE 30+floor(random()*240)::integer END;
          duration := greatest(1,ceil(duration*speed)::integer);
          next_t := pg_temp.demo_advance(t,duration);
          EXIT WHEN next_t>cutoff;
          times := array_append(times,next_t); t := next_t;
        END LOOP;
        target := array_length(times,1);
        started := CASE WHEN target>=2 THEN times[2] END;
        completed := CASE WHEN array_position(stages,'DONE')<=target THEN times[array_position(stages,'DONE')] END;
        archived := CASE WHEN stages[target]='ARCHIVE' THEN times[target] END;
        finalized := NULL;
        IF archived IS NOT NULL AND (d<27 OR random()<0.78) AND NOT(d=29 AND n=7) THEN
          next_t := pg_temp.demo_advance(archived,20+floor(random()*180)::integer);
          IF next_t<=cutoff THEN finalized := next_t; END IF;
        END IF;
        INSERT INTO public.orders(id,spk_code,customer_id,branch_id,production_type,meter,
          paper_width,customer_type,order_state,current_step_id,order_date,due_at,started_at,
          completed_at,archived_at,archive_finalized_at,delivery_method,notes,source,created_at,updated_at,created_by)
        VALUES(oid,spk,customer_ids[customer_idx],b.id,kind,meters,width,
          CASE WHEN scenario=6 OR random()<0.15 THEN 'priority' ELSE 'regular' END,
          CASE WHEN completed IS NULL THEN 'active' ELSE 'completed' END,
          (SELECT id FROM public.production_steps WHERE code=stages[target]),day_date,
          due,started,completed,archived,finalized,
          CASE WHEN archived IS NOT NULL THEN CASE WHEN random()<0.65 THEN 'pickup' ELSE 'delivery' END END,
          'Judul file: '||file_title||E'\nJenis kain: '||fabric||E'\nPanjang layout: '||replace(meters::text,'.',',')||' x '||replace(width::text,'.',',')||' m'
            ||E'\nKeterangan: '||notes[1+floor(random()*array_length(notes,1))::integer],
          'simulation',arrival,coalesce(finalized,t),actor);
        FOR k IN 1..target LOOP
          INSERT INTO public.process_history(order_id,order_identity,branch_id,spk_code,step_id,event_kind,occurred_at,actor_name,customer_name)
          VALUES(oid,oid::text,b.id,spk,(SELECT id FROM public.production_steps WHERE code=stages[k]),
            'entered',times[k],coalesce(actor_label,'Tim '||b.name)||' (SIMULASI)',customer_names[customer_idx]);
          IF k<target THEN
            INSERT INTO public.process_history(order_id,order_identity,branch_id,spk_code,step_id,event_kind,occurred_at,actor_name,customer_name)
            VALUES(oid,oid::text,b.id,spk,(SELECT id FROM public.production_steps WHERE code=stages[k]),
              CASE WHEN (SELECT sequence FROM production_steps WHERE code=stages[k+1]) > (SELECT sequence FROM production_steps WHERE code=stages[k]) THEN 'completed' ELSE 'returned' END,times[k+1],coalesce(actor_label,'Tim '||b.name)||' (SIMULASI)',customer_names[customer_idx]);
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO public.printex_row_changes(table_name,row_id,branch_key,revision,deleted)
SELECT name,id,branch_id::text,r.revision,false FROM (
 SELECT 'orders' AS name,id,branch_id FROM public.orders UNION ALL
 SELECT 'customers',id,branch_id FROM public.customers UNION ALL
 SELECT 'process_history',id,branch_id FROM public.process_history
) current_rows CROSS JOIN demo_sync_revision r
ON CONFLICT(table_name,row_id,branch_key) DO UPDATE SET revision=EXCLUDED.revision,deleted=false;
ALTER TABLE public.orders ENABLE TRIGGER printex_track_change;
ALTER TABLE public.customers ENABLE TRIGGER printex_track_change;
ALTER TABLE public.process_history ENABLE TRIGGER printex_track_change;

-- Abort instead of committing an inconsistent timeline.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM process_history h JOIN orders o ON o.id=h.order_id
   WHERE h.branch_id<>o.branch_id OR h.occurred_at<o.created_at OR h.occurred_at>transaction_timestamp()) THEN RAISE EXCEPTION 'Invalid simulated timeline'; END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE source<>'simulation' OR spk_code !~ '^PTXID[0-9A-F]{8}$') THEN RAISE EXCEPTION 'Invalid simulated order format'; END IF;
 IF EXISTS(SELECT branch_id FROM orders GROUP BY branch_id HAVING count(*) NOT BETWEEN 900 AND 1500) THEN RAISE EXCEPTION 'Branch volume outside requested range'; END IF;
 IF EXISTS(SELECT 1 FROM branches b WHERE b.is_active AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.branch_id=b.id)) THEN RAISE EXCEPTION 'Active branch missing orders'; END IF;
END $$;

SELECT b.name AS cabang,count(o.id) AS total_order,
  count(o.id) FILTER(WHERE o.completed_at IS NOT NULL) AS order_selesai,
  count(o.id) FILTER(WHERE o.archive_finalized_at IS NOT NULL) AS arsip_final,
  coalesce(sum(o.meter) FILTER(WHERE EXISTS(SELECT 1 FROM public.process_history h JOIN public.production_steps s
    ON s.id=h.step_id WHERE h.order_id=o.id AND s.code='PRINTING' AND h.event_kind='completed')),0) AS output_meter
FROM public.branches b LEFT JOIN public.orders o ON o.branch_id=b.id GROUP BY b.id,b.name ORDER BY total_order DESC;
