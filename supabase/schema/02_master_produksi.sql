-- Data induk produksi: tahap board, mesin, serta waktu kerja dan operator standar (satu lokasi: Salatiga).

-- ===== Tahap board =====
-- DESIGN boleh dilewati (Order Masuk -> Menunggu Pembayaran); DTF boleh melewati Press.
-- ARCHIVE = "Order Diterima Customer"; laporan arsip dihitung dari kolom arsip pada orders.
CREATE TABLE public.production_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sequence integer NOT NULL UNIQUE
);
INSERT INTO public.production_steps(code,name,sequence) VALUES
  ('ORDER_IN','Order Masuk',1),
  ('DESIGN','Proses Desain',2),
  ('DESIGN_DONE','Menunggu Pembayaran',3),
  ('PRINTING','Proses Sublim',4),
  ('PRESS','Proses Press',5),
  ('DONE','Order Selesai',6),
  ('ARCHIVE','Order Diterima Customer',7);
ALTER TABLE public.production_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_steps_read ON public.production_steps FOR SELECT TO authenticated USING (public.printex_staff());

-- ===== Mesin =====
-- Fedar mencetak Sublim (semua jenis selain DTF), DTF mencetak DTF, Press mengepres lini Sublim.
-- Penghapusan bersifat lunak agar order lama tetap menunjuk mesinnya.
CREATE TABLE public.production_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('fedar','dtf','press')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name=btrim(name)),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE UNIQUE INDEX production_machines_active_name ON public.production_machines(lower(name)) WHERE removed_at IS NULL;
INSERT INTO public.production_machines(kind,name) VALUES
  ('fedar','Fedar 1'),('fedar','Fedar 2'),('dtf','DTF 1'),('press','Press 1');
ALTER TABLE public.production_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_machines_read ON public.production_machines FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY production_machines_insert ON public.production_machines FOR INSERT TO authenticated WITH CHECK (public.printex_admin());
CREATE POLICY production_machines_update ON public.production_machines FOR UPDATE TO authenticated
  USING (public.printex_admin()) WITH CHECK (public.printex_admin());

-- ===== Waktu kerja dan operator standar (satu baris) =====
-- Jam tersedia = shift x jam per shift; jam efektif (T) = jam tersedia - istirahat & setup.
-- Standar: 1 shift 9 jam, istirahat 1,5 jam + briefing/setup 30 menit (T = 7 jam).
-- Operator standar: Fedar 1 per mesin (2), DTF 1 per mesin (1), Press 3 per mesin (3), desain 1.
CREATE TABLE public.production_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  shifts smallint NOT NULL DEFAULT 1 CHECK (shifts BETWEEN 1 AND 3),
  shift_hours numeric(4,2) NOT NULL DEFAULT 9 CHECK (shift_hours > 0 AND shift_hours <= 24),
  planned_downtime_minutes integer NOT NULL DEFAULT 120 CHECK (planned_downtime_minutes BETWEEN 0 AND 1440),
  effective_hours numeric(4,2) NOT NULL DEFAULT 7 CHECK (effective_hours > 0 AND effective_hours <= 24),
  operators_printing smallint NOT NULL DEFAULT 2 CHECK (operators_printing BETWEEN 0 AND 50),
  operators_dtf smallint NOT NULL DEFAULT 1 CHECK (operators_dtf BETWEEN 0 AND 50),
  operators_press smallint NOT NULL DEFAULT 3 CHECK (operators_press BETWEEN 0 AND 50),
  operators_design smallint NOT NULL DEFAULT 1 CHECK (operators_design BETWEEN 0 AND 50),
  -- Desain dihitung per order, bukan per meter (opsional): kapasitas desain = order/jam x T.
  design_orders_per_hour numeric(6,2) CHECK (design_orders_per_hour > 0 AND design_orders_per_hour <= 1000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE FUNCTION public.printex_working_hours() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.effective_hours := round(NEW.shifts*NEW.shift_hours - NEW.planned_downtime_minutes/60.0, 2);
  IF NEW.shifts*NEW.shift_hours > 24 THEN RAISE EXCEPTION 'Jam kerja tersedia maksimal 24 jam per hari'; END IF;
  IF NEW.effective_hours <= 0 THEN RAISE EXCEPTION 'Istirahat & setup harus lebih kecil dari jam kerja tersedia'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER working_hours BEFORE INSERT OR UPDATE ON public.production_settings
  FOR EACH ROW EXECUTE FUNCTION public.printex_working_hours();
INSERT INTO public.production_settings(singleton) VALUES (true);
ALTER TABLE public.production_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_settings_read ON public.production_settings FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY production_settings_write ON public.production_settings FOR UPDATE TO authenticated
  USING (public.printex_admin()) WITH CHECK (public.printex_admin());
