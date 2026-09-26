-- Optional customer WhatsApp. Preserves existing numbers when omitted by older clients.
BEGIN;
CREATE OR REPLACE FUNCTION public.printex_mutate_order(p_action text, p_order_id uuid, p_expected_version bigint, p_data jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.orders; customer_uuid uuid; stage_uuid uuid; result_id uuid; actor_role text; source_code text;
BEGIN
  -- Lock the authenticated profile until commit, including against concurrent role changes.
  SELECT p.role INTO actor_role FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun belum diberi akses oleh admin' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','edit','move','delete','archive','finish') THEN RAISE EXCEPTION 'Aksi tidak valid'; END IF;
  IF actor_role='operator' AND p_action<>'move' THEN
    RAISE EXCEPTION 'Operator tidak dapat menambah, mengedit, menghapus, atau mengarsipkan order' USING ERRCODE='42501';
  END IF;
  IF p_action IN ('create','edit') THEN
    IF length(trim(p_data->>'customerPhone')) > 30 THEN
      RAISE EXCEPTION 'Nomor WhatsApp maksimal 30 karakter';
    END IF;
    IF nullif(trim(p_data->>'customerName'),'') IS NULL OR length(p_data->>'customerName') > 200
       OR (p_data->>'productionType') NOT IN ('Sublim','DTF','Umbul-umbul','Batik','Jersey')
       OR p_data->>'productionType' IS NULL OR (p_data->>'meter')::numeric < 0
       OR (p_data->>'meter') IS NULL OR (p_data->>'customerType') NOT IN ('regular','priority')
       OR p_data->>'customerType' IS NULL OR nullif(p_data->>'orderDate','') IS NULL OR nullif(p_data->>'dueDate','') IS NULL THEN
      RAISE EXCEPTION 'Data order tidak lengkap atau tidak valid';
    END IF;
  END IF;
  IF p_action = 'create' THEN
    -- Client-generated UUID makes retry after a lost response idempotent.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id) THEN RETURN p_order_id; END IF;
    INSERT INTO public.customers(name,phone) VALUES(trim(p_data->>'customerName'),nullif(trim(p_data->>'customerPhone'),'')) RETURNING id INTO customer_uuid;
    INSERT INTO public.orders(id,spk_code,customer_id,production_type,meter,customer_type,order_date,due_at,notes,created_by)
    VALUES(p_order_id,'SPK-'||nextval('public.printex_spk_seq'),customer_uuid,p_data->>'productionType',
      (p_data->>'meter')::numeric,p_data->>'customerType',(p_data->>'orderDate')::date,(p_data->>'dueDate')::date,
      COALESCE(p_data->>'notes',''),auth.uid()) RETURNING id INTO result_id;
    RETURN result_id;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order sudah dihapus atau tidak ditemukan'; END IF;
  IF actor_role='operator' THEN
    SELECT code INTO source_code FROM public.production_steps WHERE id=o.current_step_id;
    IF source_code IS NULL OR source_code NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE')
      OR COALESCE(p_data->>'code','') NOT IN ('DESIGN_DONE','PRINTING','PRESS','DONE') THEN
      RAISE EXCEPTION 'Operator hanya dapat memindahkan order antara Menunggu Pembayaran, Sublim, Press, dan Order Selesai' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_action='finish' AND o.archive_finalized_at IS NOT NULL THEN RETURN o.id; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Order sudah diubah perangkat lain. Muat ulang dan coba lagi.' USING ERRCODE='40001'; END IF;
  CASE p_action
  WHEN 'edit' THEN
    IF nullif(trim(p_data->>'spkCode'),'') IS NULL THEN RAISE EXCEPTION 'Kode SPK wajib diisi'; END IF;
    UPDATE public.customers SET name=trim(p_data->>'customerName'),phone=CASE WHEN p_data ? 'customerPhone' THEN nullif(trim(p_data->>'customerPhone'),'') ELSE phone END,updated_at=statement_timestamp() WHERE id=o.customer_id;
    UPDATE public.orders SET spk_code=trim(p_data->>'spkCode'),production_type=p_data->>'productionType',meter=(p_data->>'meter')::numeric,
      customer_type=p_data->>'customerType',order_date=(p_data->>'orderDate')::date,due_at=(p_data->>'dueDate')::date,notes=COALESCE(p_data->>'notes','') WHERE id=o.id;
  WHEN 'move' THEN
    IF p_data->>'code' = 'ARCHIVE' THEN RAISE EXCEPTION 'Konfirmasi penyerahan sebelum arsip'; END IF;
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
COMMIT;
