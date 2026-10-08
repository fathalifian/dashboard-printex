-- Receipt is reported from orders.archive_finalized_at, not a seventh process.
-- Preserve stored history; omit unused archive-stage rows from dashboard reads.
BEGIN;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb,uuid,boolean,text[])'::regprocedure) INTO definition;
 IF position('skip_archive_process' IN definition)=0 THEN
  definition:=replace(definition,'WHERE ($6 IS NULL OR h.id>$6)',
   'WHERE ($6 IS NULL OR h.id>$6) AND h.step_id NOT IN (SELECT id FROM public.production_steps WHERE code=''''ARCHIVE'''') /* skip_archive_process */');
  EXECUTE definition;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
