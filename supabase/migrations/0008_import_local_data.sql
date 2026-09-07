BEGIN;
-- Admin-only, transactional import of the existing browser snapshot and audit.
CREATE OR REPLACE FUNCTION public.printex_import_local(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; evt jsonb; new_id uuid; customer_uuid uuid; step_uuid uuid; inserted_count integer:=0;
  existing_id uuid; expected_code text; original_id text;
BEGIN
  IF NOT public.printex_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh memindahkan data lokal' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'history') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'orders') > 10000 OR jsonb_array_length(p_payload->'history') > 100000 THEN
    RAISE EXCEPTION 'Format atau ukuran data impor tidak valid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('printex-local-import',0));
  PERFORM set_config('printex.importing','yes',true);
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'orders') LOOP
    original_id:=item->>'id';
    IF nullif(original_id,'') IS NULL OR nullif(item->>'spk_code','') IS NULL OR nullif(item->'customer'->>'name','') IS NULL THEN
      RAISE EXCEPTION 'Identitas order impor tidak lengkap';
    END IF;
    SELECT id INTO existing_id FROM public.orders WHERE legacy_id=original_id;
    IF FOUND THEN CONTINUE; END IF;
    new_id:=md5('printex-local:'||original_id)::uuid;
    expected_code:=CASE item->>'board_stage' WHEN 'incoming' THEN 'ORDER_IN' WHEN 'design' THEN 'DESIGN'
      WHEN 'design_done' THEN 'DESIGN_DONE' WHEN 'printing' THEN 'PRINTING' WHEN 'done' THEN 'DONE' WHEN 'archive' THEN 'ARCHIVE' END;
    SELECT id INTO STRICT step_uuid FROM public.production_steps WHERE code=expected_code;
    IF expected_code='ARCHIVE' AND (nullif(item->'archive'->>'archivedAt','') IS NULL OR item->'archive'->>'deliveryMethod' NOT IN ('pickup','delivery')) THEN
      RAISE EXCEPTION 'Data penyerahan arsip tidak lengkap';
    END IF;
    INSERT INTO public.customers(name,phone) VALUES(item->'customer'->>'name',nullif(item->'customer'->>'phone','')) RETURNING id INTO customer_uuid;
    INSERT INTO public.orders(id,legacy_id,spk_code,customer_id,current_step_id,production_type,meter,customer_type,order_state,
      order_date,due_at,notes,created_at,source,archived_at,delivery_method,archive_finalized_at)
    VALUES(new_id,original_id,item->>'spk_code',customer_uuid,step_uuid,item->>'production_type',(item->>'meter')::numeric,
      item->>'customer_type',CASE WHEN expected_code IN ('DONE','ARCHIVE') THEN 'completed' ELSE 'active' END,
      (item->>'order_date')::date,nullif(item->>'due_at','')::date,COALESCE(item->>'notes',''),(item->>'created_at')::timestamptz,
      'local_import',nullif(item->'archive'->>'archivedAt','')::timestamptz,item->'archive'->>'deliveryMethod',
      nullif(item->'archive'->>'finalizedAt','')::timestamptz);
    inserted_count:=inserted_count+1;
  END LOOP;
  FOR evt IN SELECT value FROM jsonb_array_elements(p_payload->'history') LOOP
    original_id:=evt->>'orderId';
    new_id:=md5('printex-local:'||original_id)::uuid;
    SELECT id INTO existing_id FROM public.orders WHERE id=new_id;
    expected_code:=CASE evt->>'stage' WHEN 'incoming' THEN 'ORDER_IN' WHEN 'design' THEN 'DESIGN' WHEN 'design_done' THEN 'DESIGN_DONE'
      WHEN 'printing' THEN 'PRINTING' WHEN 'done' THEN 'DONE' WHEN 'archive' THEN 'ARCHIVE' END;
    SELECT id INTO STRICT step_uuid FROM public.production_steps WHERE code=expected_code;
    INSERT INTO public.process_history(order_id,order_identity,spk_code,step_id,event_kind,occurred_at,customer_name,legacy_event_id)
    VALUES(existing_id,new_id::text,evt->>'spkCode',step_uuid,evt->>'kind',(evt->>'occurredAt')::timestamptz,
      COALESCE(evt->>'customerName',''),evt->>'id') ON CONFLICT(legacy_event_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('printex.importing','no',true);
  PERFORM setval('public.printex_spk_seq',GREATEST((SELECT last_value FROM public.printex_spk_seq),
    COALESCE((SELECT max(substring(spk_code FROM '^SPK-([0-9]+)$')::bigint) FROM public.orders),1099)),true);
  RETURN jsonb_build_object('imported',inserted_count);
END $$;
REVOKE ALL ON FUNCTION public.printex_import_local(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printex_import_local(jsonb) TO authenticated;

-- Preserve imported order_identity even for historical orders already deleted.
CREATE OR REPLACE FUNCTION public.set_process_order_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('printex.importing',true) IS DISTINCT FROM 'yes' THEN NEW.order_identity:=NEW.order_id::text; END IF;
  RETURN NEW;
END $$;
COMMIT;
