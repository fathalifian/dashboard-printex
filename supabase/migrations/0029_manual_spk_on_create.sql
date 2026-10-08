-- Use the manually entered SPK on create; preserve retries and legacy clients.
BEGIN;
DO $$ DECLARE definition text; generated text := '''SPK-''||nextval(''public.printex_spk_seq'')'; BEGIN
 SELECT pg_get_functiondef('public.printex_mutate_order(text,uuid,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('manual_spk_on_create' IN definition)=0 THEN
  IF position(generated IN definition)=0 THEN RAISE EXCEPTION 'SPK generator not recognized; refusing function replacement'; END IF;
  definition:=replace(definition,generated,
   'coalesce(nullif(trim(p_data->>''spkCode''),''''),'||generated||') /* manual_spk_on_create */');
  definition:=replace(definition,'IF p_action = ''create'' THEN',
   'IF p_action = ''create'' THEN IF p_data ? ''spkCode'' AND nullif(trim(p_data->>''spkCode''),'''') IS NULL THEN RAISE EXCEPTION ''Kode SPK wajib diisi''; END IF;');
  EXECUTE definition;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
