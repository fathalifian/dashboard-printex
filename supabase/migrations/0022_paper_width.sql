-- Apply after existing order migrations; supports single-branch and branch RPCs.
BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paper_width numeric;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_paper_width_check') THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_paper_width_check CHECK(paper_width IS NULL OR (production_type='Sublim' AND paper_width IN (1.2,1.6,1.8)));
 END IF;
END $$;
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.printex_mutate_order(text,uuid,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('paperWidth' IN definition)=0 THEN
  IF position('production_type,meter,customer_type' IN definition)=0 OR position('meter=(p_data->>''meter'')::numeric,' IN definition)=0 THEN
   RAISE EXCEPTION 'Versi RPC tidak dikenali. Jalankan migrasi order sebelumnya.';
  END IF;
  definition := replace(definition, 'IF p_action IN (''create'',''edit'') THEN',
   'IF p_action IN (''create'',''edit'') THEN
    IF p_data ? ''paperWidth'' AND p_data->>''paperWidth'' IS NOT NULL AND
      ((p_data->>''paperWidth'') NOT IN (''1.2'',''1.6'',''1.8'') OR p_data->>''productionType'' <> ''Sublim'') THEN
      RAISE EXCEPTION ''Lebar kertas hanya untuk Sublim: pilih 1,2, 1,6, atau 1,8 meter'';
    END IF;');
  definition := replace(definition,'production_type,meter,customer_type','production_type,meter,paper_width,customer_type');
  definition := replace(definition,'(p_data->>''meter'')::numeric,p_data->>''customerType''','(p_data->>''meter'')::numeric,(p_data->>''paperWidth'')::numeric,p_data->>''customerType''');
  definition := replace(definition,'meter=(p_data->>''meter'')::numeric,',
   'meter=(p_data->>''meter'')::numeric,paper_width=CASE WHEN p_data->>''productionType''<>''Sublim'' THEN NULL WHEN p_data ? ''paperWidth'' THEN (p_data->>''paperWidth'')::numeric ELSE o.paper_width END,');
  EXECUTE definition;
 END IF;
END $migration$;
COMMIT;
