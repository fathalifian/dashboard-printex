-- Production capacity: machines, working time, standard crew, day overrides of the crew,
-- and machine runs ("Mulai/Selesai cetak"). Safe to rerun.

-- ===== Machines =====
-- Fedar prints Sublim (every non-DTF type), DTF prints DTF, Press presses the Sublim line.
-- Removal is soft so archived orders keep their machine.
DO $$ BEGIN
 IF to_regclass('public.production_machines') IS NULL THEN
  CREATE TABLE public.production_machines (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   kind text NOT NULL CHECK (kind IN ('fedar','dtf','press')),
   name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name = btrim(name)),
   created_at timestamptz NOT NULL DEFAULT now(),
   removed_at timestamptz
  );
  -- Seed only on first install: rerunning must not resurrect machines removed later.
  INSERT INTO public.production_machines(kind,name) VALUES ('fedar','Fedar 1'),('fedar','Fedar 2'),('dtf','DTF 1'),('press','Press 1');
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS production_machines_active_name ON public.production_machines(lower(name)) WHERE removed_at IS NULL;
ALTER TABLE public.production_machines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_machines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_machines TO authenticated;
GRANT INSERT(kind,name) ON public.production_machines TO authenticated;
GRANT UPDATE(name,removed_at) ON public.production_machines TO authenticated;
DROP POLICY IF EXISTS production_machines_read ON public.production_machines;
CREATE POLICY production_machines_read ON public.production_machines FOR SELECT TO authenticated USING(public.printex_staff());
DROP POLICY IF EXISTS production_machines_insert ON public.production_machines;
CREATE POLICY production_machines_insert ON public.production_machines FOR INSERT TO authenticated WITH CHECK(public.printex_admin());
DROP POLICY IF EXISTS production_machines_update ON public.production_machines;
CREATE POLICY production_machines_update ON public.production_machines FOR UPDATE TO authenticated USING(public.printex_admin()) WITH CHECK(public.printex_admin());

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS print_machine_id uuid REFERENCES public.production_machines(id);
CREATE INDEX IF NOT EXISTS orders_print_machine ON public.orders(print_machine_id) WHERE print_machine_id IS NOT NULL;

-- ===== Working time and standard crew (one row) =====
-- Available = shifts x shift_hours; effective (T) = available - break & setup.
-- Standard: 1 shift of 9 hours, 2 hours break & setup (T = 7 hours); crew follows the
-- seeded machines: Fedar 1 per machine (2), DTF 1 per machine (1), Press 3 per machine (3), 1 designer.
CREATE TABLE IF NOT EXISTS public.production_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 shifts smallint NOT NULL DEFAULT 1 CHECK (shifts BETWEEN 1 AND 3),
 shift_hours numeric(4,2) NOT NULL DEFAULT 9 CHECK (shift_hours > 0 AND shift_hours <= 24),
 planned_downtime_minutes integer NOT NULL DEFAULT 120 CHECK (planned_downtime_minutes BETWEEN 0 AND 1440),
 effective_hours numeric(4,2) NOT NULL DEFAULT 7 CHECK (effective_hours > 0 AND effective_hours <= 24),
 operators_printing smallint NOT NULL DEFAULT 2 CHECK (operators_printing BETWEEN 0 AND 50),
 operators_dtf smallint NOT NULL DEFAULT 1 CHECK (operators_dtf BETWEEN 0 AND 50),
 operators_press smallint NOT NULL DEFAULT 3 CHECK (operators_press BETWEEN 0 AND 50),
 operators_design smallint NOT NULL DEFAULT 1 CHECK (operators_design BETWEEN 0 AND 50),
 -- Design works per order, not per meter (optional): design capacity = orders/hour x T.
 design_orders_per_hour numeric(6,2) CHECK (design_orders_per_hour > 0 AND design_orders_per_hour <= 1000),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE OR REPLACE FUNCTION public.printex_working_hours() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.effective_hours := round(NEW.shifts*NEW.shift_hours - NEW.planned_downtime_minutes/60.0, 2);
 IF NEW.shifts*NEW.shift_hours > 24 THEN RAISE EXCEPTION 'Jam kerja tersedia maksimal 24 jam per hari'; END IF;
 IF NEW.effective_hours <= 0 THEN RAISE EXCEPTION 'Istirahat & setup harus lebih kecil dari jam kerja tersedia'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS working_hours ON public.production_settings;
CREATE TRIGGER working_hours BEFORE INSERT OR UPDATE ON public.production_settings FOR EACH ROW EXECUTE FUNCTION public.printex_working_hours();
INSERT INTO public.production_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.production_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_settings TO authenticated;
GRANT UPDATE(shifts,shift_hours,planned_downtime_minutes,operators_printing,operators_dtf,operators_press,operators_design,design_orders_per_hour,version) ON public.production_settings TO authenticated;
DROP POLICY IF EXISTS production_settings_read ON public.production_settings;
CREATE POLICY production_settings_read ON public.production_settings FOR SELECT TO authenticated USING(public.printex_staff());
DROP POLICY IF EXISTS production_settings_write ON public.production_settings;
CREATE POLICY production_settings_write ON public.production_settings FOR UPDATE TO authenticated USING(public.printex_admin()) WITH CHECK(public.printex_admin());

-- ===== Print machine of an order =====
-- Assigns the print machine, optionally moving the order into PRINTING in the same
-- transaction. The move itself reuses printex_mutate_order and all of its role rules.
CREATE OR REPLACE FUNCTION public.printex_set_print_machine(p_order uuid, p_expected_version bigint, p_machine uuid, p_move boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; m public.production_machines; step text; required text;
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
 SELECT * INTO m FROM public.production_machines WHERE id=p_machine AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mesin tidak tersedia'; END IF;
 required := CASE WHEN upper(btrim(o.production_type))='DTF' THEN 'dtf' ELSE 'fedar' END;
 IF m.kind <> required THEN RAISE EXCEPTION 'Order DTF hanya dapat dicetak di mesin DTF; bahan lain di mesin Fedar'; END IF;
 IF p_move THEN
  PERFORM public.printex_mutate_order('move',p_order,p_expected_version,jsonb_build_object('code','PRINTING'));
 ELSIF o.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'Order telah diubah oleh pengguna lain. Muat ulang lalu coba kembali.' USING ERRCODE='40001';
 END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 SELECT code INTO step FROM public.production_steps WHERE id=o.current_step_id;
 IF step IS DISTINCT FROM 'PRINTING' THEN RAISE EXCEPTION 'Mesin hanya dapat dipilih saat order berada di Proses Sublim'; END IF;
 IF o.print_machine_id IS DISTINCT FROM p_machine THEN UPDATE public.orders SET print_machine_id=p_machine WHERE id=p_order; END IF;
END $$;

-- Per-machine print productivity from saved report contributions (stage time per order).
CREATE OR REPLACE FUNCTION public.printex_machine_productivity(p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 366 THEN RAISE EXCEPTION 'Periode tidak valid'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('machineId',x.machine,'dimension',x.dimension,'count',x.n,'meter',x.meter,'milliseconds',x.ms))
  FROM (SELECT o.print_machine_id AS machine,c.dimension,count(*) AS n,sum(c.meter) AS meter,sum(c.milliseconds) AS ms
   FROM public.report_contributions c JOIN public.orders o ON o.id=c.order_id
   WHERE c.metric='productivity' AND (c.dimension LIKE 'sublim:%' OR c.dimension LIKE 'dtf:%')
    AND c.report_date BETWEEN p_start AND p_end AND o.print_machine_id IS NOT NULL
   GROUP BY o.print_machine_id,c.dimension) x),'[]'::jsonb);
END $$;

-- ===== Operator day overrides =====
-- A day that differs from the standard crew (people x hours per person). 0 people is valid.
CREATE TABLE IF NOT EXISTS public.operator_shifts (
 work_date date NOT NULL,
 stage text NOT NULL CHECK (stage IN ('design','printing','press','dtf')),
 people smallint NOT NULL CHECK (people BETWEEN 0 AND 50),
 hours numeric(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
 updated_by uuid DEFAULT auth.uid(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (work_date,stage)
);

-- ===== Machine runs ("Mulai/Selesai cetak") =====
CREATE TABLE IF NOT EXISTS public.print_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
 stage text NOT NULL CHECK (stage IN ('printing','press')),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz CHECK (ended_at >= started_at),
 created_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS print_runs_open_order ON public.print_runs(order_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS print_runs_open_machine ON public.print_runs(machine_id) WHERE ended_at IS NULL AND machine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS print_runs_period ON public.print_runs(started_at);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['operator_shifts','print_runs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated', t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
  -- Writes go through the SECURITY DEFINER functions below.
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.printex_staff())', t||'_read', t);
 END LOOP;
END $$;

-- Day overrides are set by admins; people NULL returns the day to the standard crew.
CREATE OR REPLACE FUNCTION public.printex_set_operator_shift(p_date date, p_stage text, p_people integer, p_hours numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya admin yang dapat mengisi jam operator' USING ERRCODE='42501'; END IF;
 IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Tanggal tidak valid'; END IF;
 IF p_people IS NULL THEN
  DELETE FROM public.operator_shifts WHERE work_date=p_date AND stage=p_stage;
  RETURN;
 END IF;
 INSERT INTO public.operator_shifts(work_date,stage,people,hours) VALUES(p_date,p_stage,p_people,p_hours)
 ON CONFLICT (work_date,stage) DO UPDATE SET people=EXCLUDED.people,hours=EXCLUDED.hours,updated_by=auth.uid(),updated_at=now();
END $$;

-- One open run per order and per machine. Press uses the only active press machine.
-- Pressed DTF uses its own press line, which is not measured.
CREATE OR REPLACE FUNCTION public.printex_start_run(p_order uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; step text; run_stage text; machine uuid; busy text; new_id uuid;
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
 SELECT code INTO step FROM public.production_steps WHERE id=o.current_step_id;
 run_stage := CASE step WHEN 'PRINTING' THEN 'printing' WHEN 'PRESS' THEN 'press' END;
 IF run_stage IS NULL THEN RAISE EXCEPTION 'Mulai cetak hanya untuk order di Proses Sublim atau Proses Press'; END IF;
 IF run_stage='press' AND upper(btrim(o.production_type))='DTF' THEN RAISE EXCEPTION 'Press DTF memakai lini sendiri dan tidak dicatat'; END IF;
 IF EXISTS (SELECT 1 FROM public.print_runs WHERE order_id=p_order AND ended_at IS NULL) THEN RAISE EXCEPTION 'Order ini sedang berjalan'; END IF;
 IF run_stage='printing' THEN
  machine := o.print_machine_id;
  IF machine IS NULL THEN RAISE EXCEPTION 'Pilih mesin print terlebih dahulu'; END IF;
 ELSE
  SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] END INTO machine FROM public.production_machines WHERE kind='press' AND removed_at IS NULL;
 END IF;
 IF machine IS NOT NULL THEN
  SELECT x.spk_code INTO busy FROM public.print_runs r JOIN public.orders x ON x.id=r.order_id WHERE r.machine_id=machine AND r.ended_at IS NULL;
  IF busy IS NOT NULL THEN RAISE EXCEPTION 'Mesin masih mengerjakan SPK %. Selesaikan dulu.', busy; END IF;
 END IF;
 INSERT INTO public.print_runs(order_id,machine_id,stage) VALUES(p_order,machine,run_stage) RETURNING id INTO new_id;
 RETURN new_id;
END $$;
CREATE OR REPLACE FUNCTION public.printex_finish_run(p_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
 UPDATE public.print_runs SET ended_at=now() WHERE order_id=p_order AND ended_at IS NULL;
END $$;
-- Moving a card to another stage closes a run that was left open.
CREATE OR REPLACE FUNCTION public.printex_close_runs_on_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.print_runs SET ended_at=greatest(started_at,now()) WHERE order_id=NEW.id AND ended_at IS NULL;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS close_runs_on_move ON public.orders;
CREATE TRIGGER close_runs_on_move AFTER UPDATE OF current_step_id ON public.orders
 FOR EACH ROW WHEN (OLD.current_step_id IS DISTINCT FROM NEW.current_step_id) EXECUTE FUNCTION public.printex_close_runs_on_move();

-- Totals of a period (WIB days), clipped to the period and to now.
CREATE OR REPLACE FUNCTION public.printex_efficiency_inputs(p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ps timestamptz; pe timestamptz;
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 366 THEN RAISE EXCEPTION 'Periode tidak valid'; END IF;
 ps := p_start::timestamp AT TIME ZONE 'Asia/Jakarta';
 pe := least((p_end + 1)::timestamp AT TIME ZONE 'Asia/Jakarta', now());
 RETURN jsonb_build_object(
  'runs', coalesce((SELECT jsonb_agg(jsonb_build_object('machineId',x.machine_id,'stage',x.stage,'milliseconds',x.ms,'meter',x.meter,'count',x.n)) FROM (
    SELECT r.machine_id,r.stage,
     sum(greatest(0, extract(epoch FROM least(coalesce(r.ended_at,now()),pe) - greatest(r.started_at,ps))) * 1000)::bigint AS ms,
     sum(CASE WHEN r.ended_at >= ps AND r.ended_at < pe THEN o.meter ELSE 0 END) AS meter,
     count(*) FILTER (WHERE r.ended_at >= ps AND r.ended_at < pe) AS n
    FROM public.print_runs r JOIN public.orders o ON o.id=r.order_id
    WHERE r.started_at < pe AND coalesce(r.ended_at,now()) > ps
     AND NOT (r.stage='press' AND upper(btrim(o.production_type))='DTF')
    GROUP BY r.machine_id,r.stage) x),'[]'::jsonb),
  -- Man-hours per working day (a day with production activity or an override):
  -- the day's override, otherwise the standard crew x effective hours.
  'shifts', coalesce((SELECT jsonb_agg(jsonb_build_object('stage',x.stage,'manHours',x.mh,'peopleDays',x.pd)) FROM (
    WITH days AS (
     SELECT DISTINCT (h.occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS d FROM public.process_history h
     WHERE h.occurred_at >= ps AND h.occurred_at < pe
     UNION
     SELECT s.work_date FROM public.operator_shifts s WHERE s.work_date BETWEEN p_start AND p_end
    ), crew AS (
     SELECT st.stage,
      coalesce(s.people,CASE st.stage WHEN 'printing' THEN c.operators_printing WHEN 'dtf' THEN c.operators_dtf WHEN 'press' THEN c.operators_press ELSE c.operators_design END) AS people,
      coalesce(s.hours,c.effective_hours) AS hours
     FROM days dy CROSS JOIN public.production_settings c
     CROSS JOIN (VALUES ('design'),('printing'),('press'),('dtf')) st(stage)
     LEFT JOIN public.operator_shifts s ON s.work_date=dy.d AND s.stage=st.stage
    )
    SELECT stage,sum(people*hours) AS mh,sum(people) AS pd FROM crew WHERE people > 0 GROUP BY stage) x),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION public.printex_working_hours(),public.printex_close_runs_on_move() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['printex_set_print_machine(uuid,bigint,uuid,boolean)','printex_machine_productivity(date,date)',
  'printex_set_operator_shift(date,text,integer,numeric)','printex_start_run(uuid)','printex_finish_run(uuid)','printex_efficiency_inputs(date,date)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
 END LOOP;
END $$;

-- Capabilities read by the app at start-up.
CREATE OR REPLACE FUNCTION public.printex_online_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif. Hubungi admin.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schema_version',8,'daily_summaries_enabled',true,'production_capacity_enabled',true,'realtime_tables',
  (SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;
NOTIFY pgrst,'reload schema';
