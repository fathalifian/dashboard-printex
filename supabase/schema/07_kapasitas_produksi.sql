-- Kapasitas produksi: catatan Mulai/Selesai mesin, jam operator per hari, dan data efisiensi.
-- Press DTF memakai lini sendiri di luar dashboard: tidak dicatat dan tidak dihitung di stasiun Press.

-- Hari yang berbeda dari operator standar (orang x jam per orang). 0 orang boleh.
CREATE TABLE public.operator_shifts (
  work_date date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('design','printing','press','dtf')),
  people smallint NOT NULL CHECK (people BETWEEN 0 AND 50),
  hours numeric(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_date,stage)
);

-- Catatan "Mulai/Selesai cetak": satu catatan terbuka per order dan per mesin.
CREATE TABLE public.print_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN ('printing','press')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz CHECK (ended_at >= started_at)
);
CREATE UNIQUE INDEX print_runs_open_order ON public.print_runs(order_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX print_runs_open_machine ON public.print_runs(machine_id) WHERE ended_at IS NULL AND machine_id IS NOT NULL;
CREATE INDEX print_runs_period ON public.print_runs(started_at);

ALTER TABLE public.operator_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_runs ENABLE ROW LEVEL SECURITY;
-- Penulisan hanya lewat fungsi di bawah.
CREATE POLICY operator_shifts_read ON public.operator_shifts FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY print_runs_read ON public.print_runs FOR SELECT TO authenticated USING (public.printex_staff());

-- Order yang pindah tahap otomatis menutup catatan yang masih berjalan.
CREATE FUNCTION public.printex_close_runs_on_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.print_runs SET ended_at=greatest(started_at,now()) WHERE order_id=NEW.id AND ended_at IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER close_runs_on_move AFTER UPDATE OF current_step_id ON public.orders
  FOR EACH ROW WHEN (OLD.current_step_id IS DISTINCT FROM NEW.current_step_id)
  EXECUTE FUNCTION public.printex_close_runs_on_move();

-- Admin mengisi jam operator suatu hari; p_people NULL mengembalikan hari itu ke operator standar.
CREATE FUNCTION public.printex_set_operator_shift(p_date date, p_stage text, p_people integer, p_hours numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya admin yang dapat mengisi jam operator' USING ERRCODE='42501'; END IF;
  IF p_date IS NULL OR p_date>(now() AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Tanggal tidak valid'; END IF;
  IF p_people IS NULL THEN
    DELETE FROM public.operator_shifts WHERE work_date=p_date AND stage=p_stage;
    RETURN;
  END IF;
  INSERT INTO public.operator_shifts(work_date,stage,people,hours) VALUES(p_date,p_stage,p_people,p_hours)
  ON CONFLICT(work_date,stage) DO UPDATE SET people=excluded.people,hours=excluded.hours,updated_at=now();
END $$;

-- Mulai cetak/press. Cetak memakai mesin order; press memakai satu-satunya mesin Press bila hanya ada satu.
CREATE FUNCTION public.printex_start_run(p_order uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; step text; run_stage text; machine uuid; busy text; new_id uuid;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  SELECT code INTO step FROM public.production_steps WHERE id=o.current_step_id;
  run_stage := CASE step WHEN 'PRINTING' THEN 'printing' WHEN 'PRESS' THEN 'press' END;
  IF run_stage IS NULL THEN RAISE EXCEPTION 'Mulai cetak hanya untuk order di Proses Sublim atau Proses Press'; END IF;
  IF run_stage='press' AND upper(btrim(o.production_type))='DTF' THEN RAISE EXCEPTION 'Press DTF memakai lini sendiri dan tidak dicatat'; END IF;
  IF EXISTS(SELECT 1 FROM public.print_runs WHERE order_id=p_order AND ended_at IS NULL) THEN RAISE EXCEPTION 'Order ini sedang berjalan'; END IF;
  IF run_stage='printing' THEN
    machine := o.print_machine_id;
    IF machine IS NULL THEN RAISE EXCEPTION 'Pilih mesin print terlebih dahulu'; END IF;
  ELSE
    SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] END INTO machine
    FROM public.production_machines WHERE kind='press' AND removed_at IS NULL;
  END IF;
  IF machine IS NOT NULL THEN
    SELECT x.spk_code INTO busy FROM public.print_runs r JOIN public.orders x ON x.id=r.order_id
    WHERE r.machine_id=machine AND r.ended_at IS NULL;
    IF busy IS NOT NULL THEN RAISE EXCEPTION 'Mesin masih mengerjakan SPK %. Selesaikan dulu.', busy; END IF;
  END IF;
  INSERT INTO public.print_runs(order_id,machine_id,stage) VALUES(p_order,machine,run_stage) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE FUNCTION public.printex_finish_run(p_order uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  UPDATE public.print_runs SET ended_at=now() WHERE order_id=p_order AND ended_at IS NULL;
END $$;

-- Data kapasitas K = P x T untuk satu periode:
--   runs   = waktu mesin berjalan, meter, dan jumlah order selesai per mesin dan stasiun (tanpa press DTF);
--   shifts = jam-orang per stasiun di hari kerja (hari dengan aktivitas produksi atau isian jam operator):
--            isian hari itu, selain itu operator standar x jam efektif.
CREATE FUNCTION public.printex_efficiency_inputs(p_start date, p_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ps timestamptz; pe timestamptz;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>366 THEN RAISE EXCEPTION 'Periode tidak valid'; END IF;
  ps := p_start::timestamp AT TIME ZONE 'Asia/Jakarta';
  pe := least((p_end+1)::timestamp AT TIME ZONE 'Asia/Jakarta',now());
  RETURN jsonb_build_object(
    'runs',coalesce((SELECT jsonb_agg(jsonb_build_object('machineId',x.machine_id,'stage',x.stage,'milliseconds',x.ms,'meter',x.meter,'count',x.n)) FROM (
      SELECT r.machine_id,r.stage,
        sum(greatest(0,extract(epoch FROM least(coalesce(r.ended_at,now()),pe)-greatest(r.started_at,ps)))*1000)::bigint AS ms,
        sum(CASE WHEN r.ended_at>=ps AND r.ended_at<pe THEN o.meter ELSE 0 END) AS meter,
        count(*) FILTER (WHERE r.ended_at>=ps AND r.ended_at<pe) AS n
      FROM public.print_runs r JOIN public.orders o ON o.id=r.order_id
      WHERE r.started_at<pe AND coalesce(r.ended_at,now())>ps
        AND NOT (r.stage='press' AND upper(btrim(o.production_type))='DTF')
      GROUP BY r.machine_id,r.stage) x),'[]'::jsonb),
    'shifts',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',x.stage,'manHours',x.mh,'peopleDays',x.pd)) FROM (
      WITH days AS (
        SELECT DISTINCT (h.occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS d FROM public.process_history h
        WHERE h.occurred_at>=ps AND h.occurred_at<pe
        UNION
        SELECT s.work_date FROM public.operator_shifts s WHERE s.work_date BETWEEN p_start AND p_end
      ), crew AS (
        SELECT st.stage,
          coalesce(s.people,CASE st.stage WHEN 'printing' THEN c.operators_printing WHEN 'dtf' THEN c.operators_dtf
            WHEN 'press' THEN c.operators_press ELSE c.operators_design END) AS people,
          coalesce(s.hours,c.effective_hours) AS hours
        FROM days dy CROSS JOIN public.production_settings c
        CROSS JOIN (VALUES ('design'),('printing'),('press'),('dtf')) st(stage)
        LEFT JOIN public.operator_shifts s ON s.work_date=dy.d AND s.stage=st.stage
      )
      SELECT stage,sum(people*hours) AS mh,sum(people) AS pd FROM crew WHERE people>0 GROUP BY stage) x),'[]'::jsonb)
  );
END $$;

-- Produktivitas cetak per mesin dari laporan tersimpan (waktu tahap per order).
CREATE FUNCTION public.printex_machine_productivity(p_start date, p_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>366 THEN RAISE EXCEPTION 'Periode tidak valid'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('machineId',x.machine,'dimension',x.dimension,'count',x.n,'meter',x.meter,'milliseconds',x.ms))
    FROM (SELECT o.print_machine_id AS machine,c.dimension,count(*) AS n,sum(c.meter) AS meter,sum(c.milliseconds) AS ms
      FROM public.report_contributions c JOIN public.orders o ON o.id=c.order_id
      WHERE c.metric='productivity' AND (c.dimension LIKE 'sublim:%' OR c.dimension LIKE 'dtf:%')
        AND c.report_date BETWEEN p_start AND p_end AND o.print_machine_id IS NOT NULL
      GROUP BY o.print_machine_id,c.dimension) x),'[]'::jsonb);
END $$;
