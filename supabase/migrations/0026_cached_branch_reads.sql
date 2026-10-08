-- Evaluate the authorized branch set once per read statement, instead of
-- looking up the same profile and branch for each history row.
BEGIN;
DO $migration$
DECLARE t text;
BEGIN
 IF to_regclass('public.branches') IS NULL THEN RETURN; END IF;
 EXECUTE $function$
  CREATE OR REPLACE FUNCTION public.printex_read_branches() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
   SELECT b.id FROM public.branches b JOIN public.profiles p ON p.id=(SELECT auth.uid())
   WHERE b.is_active AND p.is_active
    AND (p.role='central_owner' OR (p.branch_id=b.id AND p.role IN ('owner','admin','operator')))
  $body$
 $function$;
 REVOKE ALL ON FUNCTION public.printex_read_branches() FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.printex_read_branches() TO authenticated;
 ALTER POLICY branches_read ON public.branches USING(id IN (SELECT public.printex_read_branches()));
 FOREACH t IN ARRAY ARRAY['orders','customers','process_history'] LOOP
  EXECUTE format('ALTER POLICY branch_read ON public.%I USING(branch_id IN (SELECT public.printex_read_branches()))',t);
 END LOOP;
END $migration$;
COMMIT;
