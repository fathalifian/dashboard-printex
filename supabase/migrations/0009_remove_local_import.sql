-- Retire the old browser-import endpoint without deleting existing online data.
BEGIN;
DROP FUNCTION IF EXISTS public.printex_import_local(jsonb);
COMMIT;
