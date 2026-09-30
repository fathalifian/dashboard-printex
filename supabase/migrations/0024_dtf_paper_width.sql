-- DTF uses 0.6 m automatically; other production uses 1.2 / 1.6 / 1.8 m.
BEGIN;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_paper_width_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_paper_width_check
 CHECK(paper_width IS NULL OR (production_type='DTF' AND paper_width=0.6) OR (production_type<>'DTF' AND paper_width IN (1.2,1.6,1.8)));
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.printex_mutate_order(text,uuid,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('paperWidth' IN definition)=0 THEN RAISE EXCEPTION 'Jalankan migrasi lebar kertas sebelumnya terlebih dahulu.'; END IF;
 IF position('-- automatic DTF paper' IN definition)=0 THEN
  definition := replace(definition, 'IF p_action IN (''create'',''edit'') THEN',
   'IF p_action IN (''create'',''edit'') THEN
    -- automatic DTF paper
    IF p_data->>''productionType'' = ''DTF'' THEN
      p_data := jsonb_set(p_data, ''{paperWidth}'', ''"0.6"''::jsonb);
    END IF;');
 END IF;
 definition := replace(definition,
  '((p_data->>''paperWidth'') NOT IN (''1.2'',''1.6'',''1.8'') OR p_data->>''productionType'' = ''DTF'')',
  '(p_data->>''productionType'' <> ''DTF'' AND (p_data->>''paperWidth'') NOT IN (''1.2'',''1.6'',''1.8''))');
 definition := replace(definition, 'WHEN p_data->>''productionType''=''DTF'' THEN NULL', 'WHEN p_data->>''productionType''=''DTF'' THEN 0.6');
 IF position('ELSE CASE WHEN o.paper_width=0.6' IN definition)=0 THEN
 definition := replace(definition, 'ELSE o.paper_width END', 'ELSE CASE WHEN o.paper_width=0.6 THEN NULL ELSE o.paper_width END END');
 END IF;
 EXECUTE definition;
END $migration$;
COMMIT;
