-- All non-DTF production uses sublimation paper. Run after paper width migration.
BEGIN;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_paper_width_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_paper_width_check
 CHECK(paper_width IS NULL OR (production_type='DTF' AND paper_width=0.6) OR (production_type<>'DTF' AND paper_width IN (1.2,1.6,1.8)));
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.printex_mutate_order(text,uuid,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('paperWidth' IN definition)=0 THEN RAISE EXCEPTION 'Jalankan migrasi lebar kertas sebelumnya terlebih dahulu.'; END IF;
 definition := replace(definition, 'p_data->>''productionType'' <> ''Sublim''', 'p_data->>''productionType'' = ''DTF''');
 definition := replace(definition, 'p_data->>''productionType''<>''Sublim''', 'p_data->>''productionType''=''DTF''');
 definition := replace(definition, 'Lebar kertas hanya untuk Sublim:', 'Lebar kertas untuk semua produksi selain DTF:');
 EXECUTE definition;
END $migration$;
COMMIT;
