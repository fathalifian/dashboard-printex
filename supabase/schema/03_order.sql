-- Order, customer, dan riwayat proses. Semua perubahan order lewat printex_mutate_order (SECURITY DEFINER);
-- karyawan hanya bisa membaca tabel secara langsung.

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nomor SPK otomatis bila SPK tidak diisi saat membuat order.
CREATE SEQUENCE public.printex_spk_seq START 1100;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spk_code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  production_type text NOT NULL,
  meter numeric(10,2) NOT NULL DEFAULT 0 CHECK (meter >= 0),
  -- Lebar kertas (meter): DTF selalu 0,6; produksi lain 1,2 / 1,6 / 1,8 atau belum diisi.
  paper_width numeric CHECK (paper_width IS NULL
    OR (production_type='DTF' AND paper_width=0.6)
    OR (production_type<>'DTF' AND paper_width IN (1.2,1.6,1.8))),
  customer_type text NOT NULL DEFAULT 'regular' CHECK (customer_type IN ('regular','priority')),
  current_step_id uuid NOT NULL REFERENCES public.production_steps(id),
  order_state text NOT NULL DEFAULT 'active' CHECK (order_state IN ('active','completed')),
  print_machine_id uuid REFERENCES public.production_machines(id),
  order_date date NOT NULL,
  due_at date,
  notes text NOT NULL DEFAULT '',
  photo_path text,
  -- 'simulation' menandai data uji (supabase/manual/2_DATA_UJI_7_HARI.sql).
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','simulation')),
  archived_at timestamptz,
  delivery_method text CHECK (delivery_method IN ('pickup','delivery','received')),
  archive_finalized_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT archive_delivery_metadata CHECK ((archived_at IS NULL) = (delivery_method IS NULL)),
  CONSTRAINT finalized_requires_archive CHECK (archive_finalized_at IS NULL OR archived_at IS NOT NULL)
);
CREATE INDEX orders_customer ON public.orders(customer_id);
CREATE INDEX orders_current_step ON public.orders(current_step_id);
CREATE INDEX orders_order_date ON public.orders(order_date);
CREATE INDEX orders_finalized_at ON public.orders(archive_finalized_at);
CREATE INDEX orders_photo_path ON public.orders(photo_path) WHERE photo_path IS NOT NULL;
CREATE INDEX orders_print_machine ON public.orders(print_machine_id) WHERE print_machine_id IS NOT NULL;

-- Riwayat ringkas: satu baris 'entered' saat order dibuat, lalu satu baris per perpindahan
-- (tahap yang ditinggalkan + tahap tujuan di next_step_id). Riwayat tetap ada bila order dihapus.
CREATE TABLE public.process_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_identity text NOT NULL,
  spk_code text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  step_id uuid NOT NULL REFERENCES public.production_steps(id),
  event_kind text NOT NULL CHECK (event_kind IN ('entered','completed','returned')),
  next_step_id uuid REFERENCES public.production_steps(id),
  next_event_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX process_history_order ON public.process_history(order_id);
CREATE INDEX process_history_scope_page ON public.process_history(order_identity, id);
CREATE INDEX process_history_scope_time ON public.process_history(occurred_at, order_identity);

-- order_identity menyimpan ID order secara permanen (order_id menjadi NULL bila order dihapus).
CREATE FUNCTION public.set_process_order_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.order_identity := NEW.order_id::text;
  RETURN NEW;
END $$;
CREATE TRIGGER process_history_set_identity BEFORE INSERT ON public.process_history
  FOR EACH ROW EXECUTE FUNCTION public.set_process_order_identity();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_read ON public.customers FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY orders_read ON public.orders FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY process_history_read ON public.process_history FOR SELECT TO authenticated USING (public.printex_staff());

-- ===== Aturan order (urutan trigger BEFORE mengikuti abjad: 00_defaults, adjacent_stage, enforce_archiving) =====
-- printex.importing='yes' hanya dipakai skrip data uji untuk menulis riwayat dengan waktu lampau.

-- Tahap awal, status, waktu ubah, dan versi untuk penguncian optimistis.
CREATE FUNCTION public.printex_order_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE step_code text;
BEGIN
  IF current_setting('printex.importing',true)='yes' THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    SELECT id INTO NEW.current_step_id FROM public.production_steps WHERE code='ORDER_IN';
  END IF;
  SELECT code INTO STRICT step_code FROM public.production_steps WHERE id=NEW.current_step_id;
  NEW.order_state := CASE WHEN step_code IN ('DONE','ARCHIVE') THEN 'completed' ELSE 'active' END;
  NEW.updated_at := statement_timestamp();
  IF TG_OP='UPDATE' THEN NEW.version := OLD.version+1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_00_defaults BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.printex_order_defaults();

-- Order hanya pindah ke tahap sebelah, kecuali melewati desain atau DTF melewati Press.
CREATE FUNCTION public.enforce_adjacent_order_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_code text; next_code text; previous_position integer; next_position integer;
BEGIN
  IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  SELECT code,sequence INTO previous_code,previous_position FROM public.production_steps WHERE id=OLD.current_step_id;
  SELECT code,sequence INTO next_code,next_position FROM public.production_steps WHERE id=NEW.current_step_id;
  IF previous_code='ORDER_IN' AND next_code='DESIGN_DONE' THEN RETURN NEW; END IF;
  IF previous_code='PRINTING' AND next_code='DONE' AND NEW.production_type='DTF' THEN RETURN NEW; END IF;
  IF previous_position IS NULL OR next_position IS NULL OR abs(next_position-previous_position)<>1 THEN
    RAISE EXCEPTION 'Orders can only move to the previous or next stage, skip design, or skip Press for DTF';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_adjacent_stage BEFORE UPDATE OF current_step_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adjacent_order_stage();

-- Arsip: hanya order Selesai dengan konfirmasi penyerahan; order arsip hanya bisa difinalisasi sekali
-- dan tidak bisa diubah atau dihapus. 'received' langsung final. Foto dilepas saat final.
CREATE FUNCTION public.enforce_order_archiving() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_code text; next_code text;
BEGIN
  IF current_setting('printex.importing',true)='yes' THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN
    SELECT code INTO previous_code FROM public.production_steps WHERE id=OLD.current_step_id;
    IF previous_code='ARCHIVE' THEN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve archived orders and reports'; END IF;
      IF (to_jsonb(NEW)-'archive_finalized_at'-'updated_at'-'version')
         IS DISTINCT FROM (to_jsonb(OLD)-'archive_finalized_at'-'updated_at'-'version') THEN
        RAISE EXCEPTION 'Archived order data is read-only';
      END IF;
      IF OLD.archive_finalized_at IS NOT NULL THEN
        RETURN OLD; -- klik berulang tidak mengubah tanggal laporan asli
      END IF;
      IF NEW.archive_finalized_at IS NOT NULL THEN
        NEW.archive_finalized_at := statement_timestamp();
        NEW.photo_path := NULL;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.archive_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Move to the archive board before finalizing'; END IF;
  SELECT code INTO next_code FROM public.production_steps WHERE id=NEW.current_step_id;
  IF next_code='ARCHIVE' THEN
    IF TG_OP='INSERT' OR previous_code IS DISTINCT FROM 'DONE' THEN RAISE EXCEPTION 'Only Done orders can be archived'; END IF;
    IF NEW.delivery_method IS NULL THEN RAISE EXCEPTION 'Confirm pickup or delivery before archiving'; END IF;
    NEW.archived_at := statement_timestamp();
    IF NEW.delivery_method='received' THEN
      NEW.archive_finalized_at := NEW.archived_at;
      NEW.photo_path := NULL;
    END IF;
    NEW.order_state := 'completed';
  ELSIF NEW.archived_at IS NOT NULL OR NEW.delivery_method IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery metadata is only valid for archived orders';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_enforce_archiving BEFORE INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_archiving();

-- Riwayat proses dicatat otomatis saat order dibuat dan setiap pindah tahap.
CREATE FUNCTION public.capture_process_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_sequence integer; next_sequence integer; customer text;
BEGIN
  IF current_setting('printex.importing',true)='yes' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  SELECT sequence INTO STRICT next_sequence FROM public.production_steps WHERE id=NEW.current_step_id;
  SELECT name INTO customer FROM public.customers WHERE id=NEW.customer_id;
  IF TG_OP='UPDATE' THEN
    SELECT sequence INTO STRICT previous_sequence FROM public.production_steps WHERE id=OLD.current_step_id;
    INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,customer_name,next_step_id,next_event_id,occurred_at)
    VALUES(NEW.id,NEW.spk_code,OLD.current_step_id,
      CASE WHEN next_sequence>previous_sequence THEN 'completed' ELSE 'returned' END,
      coalesce(customer,''),NEW.current_step_id,gen_random_uuid(),statement_timestamp());
  ELSE
    INSERT INTO public.process_history(order_id,spk_code,step_id,event_kind,customer_name,occurred_at)
    VALUES(NEW.id,NEW.spk_code,NEW.current_step_id,'entered',coalesce(customer,''),statement_timestamp());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_capture_process_history AFTER INSERT OR UPDATE OF current_step_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_process_history();

-- ===== Semua perubahan order =====
-- Owner/Admin: create, edit, move, delete, archive, finish. Operator: hanya move di antara
-- Menunggu Pembayaran, Sublim, Press, dan Order Selesai.
CREATE FUNCTION public.printex_mutate_order(p_action text, p_order_id uuid, p_expected_version bigint, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; customer_uuid uuid; stage_uuid uuid; actor_role text; source_code text;
BEGIN
  -- Profil dikunci sampai commit, termasuk terhadap perubahan peran bersamaan.
  SELECT p.role INTO actor_role FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','edit','move','delete','archive','finish') THEN RAISE EXCEPTION 'Aksi tidak valid'; END IF;
  IF actor_role='operator' AND p_action<>'move' THEN
    RAISE EXCEPTION 'Operator tidak dapat menambah, mengedit, menghapus, atau mengarsipkan order' USING ERRCODE='42501';
  END IF;

  IF p_action IN ('create','edit') THEN
    IF p_data->>'productionType'='DTF' THEN p_data := jsonb_set(p_data,'{paperWidth}','"0.6"'::jsonb); END IF;
    IF p_data->>'paperWidth' IS NOT NULL AND p_data->>'productionType'<>'DTF'
       AND p_data->>'paperWidth' NOT IN ('1.2','1.6','1.8') THEN
      RAISE EXCEPTION 'Lebar kertas untuk semua produksi selain DTF: pilih 1,2, 1,6, atau 1,8 meter';
    END IF;
    IF length(trim(p_data->>'customerPhone'))>30 THEN RAISE EXCEPTION 'Nomor WhatsApp maksimal 30 karakter'; END IF;
    IF nullif(trim(p_data->>'customerName'),'') IS NULL OR length(p_data->>'customerName')>200
       OR p_data->>'productionType' IS NULL OR p_data->>'productionType' NOT IN ('Sublim','DTF','Umbul-umbul','Batik','Jersey')
       OR p_data->>'meter' IS NULL OR (p_data->>'meter')::numeric<0
       OR p_data->>'customerType' IS NULL OR p_data->>'customerType' NOT IN ('regular','priority')
       OR nullif(p_data->>'orderDate','') IS NULL OR nullif(p_data->>'dueDate','') IS NULL THEN
      RAISE EXCEPTION 'Data order tidak lengkap atau tidak valid';
    END IF;
  END IF;

  IF p_action='create' THEN
    IF p_data ? 'spkCode' AND nullif(trim(p_data->>'spkCode'),'') IS NULL THEN RAISE EXCEPTION 'Kode SPK wajib diisi'; END IF;
    -- UUID dari klien membuat pengiriman ulang setelah respons hilang tetap aman.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id) THEN RETURN p_order_id; END IF;
    INSERT INTO public.customers(name,phone)
      VALUES(trim(p_data->>'customerName'),nullif(trim(p_data->>'customerPhone'),'')) RETURNING id INTO customer_uuid;
    INSERT INTO public.orders(id,spk_code,customer_id,production_type,meter,paper_width,customer_type,order_date,due_at,notes)
    VALUES(p_order_id,coalesce(nullif(trim(p_data->>'spkCode'),''),'SPK-'||nextval('public.printex_spk_seq')),customer_uuid,
      p_data->>'productionType',(p_data->>'meter')::numeric,(p_data->>'paperWidth')::numeric,p_data->>'customerType',
      (p_data->>'orderDate')::date,(p_data->>'dueDate')::date,coalesce(p_data->>'notes',''));
    RETURN p_order_id;
  END IF;

  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order sudah dihapus atau tidak ditemukan'; END IF;
  IF actor_role='operator' THEN
    SELECT code INTO source_code FROM public.production_steps WHERE id=o.current_step_id;
    IF source_code IS NULL OR source_code NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE')
       OR coalesce(p_data->>'code','') NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE') THEN
      RAISE EXCEPTION 'Operator hanya dapat memindahkan order antara Menunggu Pembayaran, Sublim, Press, dan Order Selesai' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_action='finish' AND o.archive_finalized_at IS NOT NULL THEN RETURN o.id; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001';
  END IF;
  CASE p_action
  WHEN 'edit' THEN
    IF nullif(trim(p_data->>'spkCode'),'') IS NULL THEN RAISE EXCEPTION 'Kode SPK wajib diisi'; END IF;
    UPDATE public.customers SET name=trim(p_data->>'customerName'),
      phone=CASE WHEN p_data ? 'customerPhone' THEN nullif(trim(p_data->>'customerPhone'),'') ELSE phone END,
      updated_at=statement_timestamp() WHERE id=o.customer_id;
    -- Klien lama tanpa paperWidth mempertahankan lebar yang tersimpan.
    UPDATE public.orders SET spk_code=trim(p_data->>'spkCode'),production_type=p_data->>'productionType',meter=(p_data->>'meter')::numeric,
      paper_width=CASE WHEN p_data->>'productionType'='DTF' THEN 0.6
        WHEN p_data ? 'paperWidth' THEN (p_data->>'paperWidth')::numeric
        WHEN o.paper_width=0.6 THEN NULL ELSE o.paper_width END,
      customer_type=p_data->>'customerType',order_date=(p_data->>'orderDate')::date,due_at=(p_data->>'dueDate')::date,
      notes=coalesce(p_data->>'notes','') WHERE id=o.id;
  WHEN 'move' THEN
    IF p_data->>'code'='ARCHIVE' THEN RAISE EXCEPTION 'Konfirmasi penyerahan sebelum arsip'; END IF;
    SELECT id INTO STRICT stage_uuid FROM public.production_steps WHERE code=p_data->>'code';
    UPDATE public.orders SET current_step_id=stage_uuid WHERE id=o.id;
  WHEN 'archive' THEN
    SELECT id INTO STRICT stage_uuid FROM public.production_steps WHERE code='ARCHIVE';
    UPDATE public.orders SET current_step_id=stage_uuid,delivery_method=p_data->>'deliveryMethod' WHERE id=o.id;
  WHEN 'finish' THEN
    UPDATE public.orders SET archive_finalized_at=statement_timestamp() WHERE id=o.id;
  WHEN 'delete' THEN
    DELETE FROM public.orders WHERE id=o.id;
  END CASE;
  RETURN o.id;
END $$;

-- Mesin cetak order; bisa sekaligus memindahkan order ke Proses Sublim dalam satu transaksi
-- (perpindahan memakai printex_mutate_order dan seluruh aturannya).
CREATE FUNCTION public.printex_set_print_machine(p_order uuid, p_expected_version bigint, p_machine uuid, p_move boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; m public.production_machines; step text; required text;
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  SELECT * INTO m FROM public.production_machines WHERE id=p_machine AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mesin tidak tersedia'; END IF;
  required := CASE WHEN upper(btrim(o.production_type))='DTF' THEN 'dtf' ELSE 'fedar' END;
  IF m.kind<>required THEN RAISE EXCEPTION 'Order DTF hanya dapat dicetak di mesin DTF; bahan lain di mesin Fedar'; END IF;
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
