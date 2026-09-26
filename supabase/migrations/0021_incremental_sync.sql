-- Transactional change cursor. No business row contents are stored here.
BEGIN;
CREATE TABLE IF NOT EXISTS public.printex_sync_clock (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.printex_sync_clock(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.printex_row_changes (
 table_name text NOT NULL, row_id uuid NOT NULL, branch_key text NOT NULL DEFAULT '',
 revision bigint NOT NULL, deleted boolean NOT NULL,
 PRIMARY KEY(table_name,row_id,branch_key)
);
CREATE INDEX IF NOT EXISTS printex_changes_revision ON public.printex_row_changes(revision);
ALTER TABLE public.printex_sync_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printex_row_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.printex_sync_clock,public.printex_row_changes FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.printex_record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rev bigint; item jsonb; prior jsonb;
BEGIN
 -- The row lock is held until commit: cursors cannot skip a late-committing transaction.
 UPDATE public.printex_sync_clock SET revision=revision+1 WHERE singleton RETURNING revision INTO rev;
 item := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' THEN
  prior := to_jsonb(OLD);
  IF prior->>'branch_id' IS DISTINCT FROM item->>'branch_id' THEN
   INSERT INTO public.printex_row_changes VALUES(TG_TABLE_NAME,(prior->>'id')::uuid,coalesce(prior->>'branch_id',''),rev,true)
   ON CONFLICT(table_name,row_id,branch_key) DO UPDATE SET revision=EXCLUDED.revision,deleted=true;
  END IF;
 END IF;
 INSERT INTO public.printex_row_changes VALUES(TG_TABLE_NAME,(item->>'id')::uuid,coalesce(item->>'branch_id',''),rev,TG_OP='DELETE')
 ON CONFLICT(table_name,row_id,branch_key) DO UPDATE SET revision=EXCLUDED.revision,deleted=EXCLUDED.deleted;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.printex_record_change() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','customers','production_steps','process_history'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS printex_track_change ON public.%I',t);
  EXECUTE format('CREATE TRIGGER printex_track_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.printex_record_change()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.printex_sync_changes(p_after bigint DEFAULT NULL,p_branch uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE permitted boolean; branch_mode boolean; result jsonb;
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 branch_mode := to_regclass('public.branches') IS NOT NULL;
 IF branch_mode THEN
  IF p_branch IS NULL THEN EXECUTE 'SELECT public.printex_central_owner()' INTO permitted;
  ELSE EXECUTE 'SELECT public.printex_branch_access($1)' INTO permitted USING p_branch; END IF;
  IF NOT permitted THEN RAISE EXCEPTION 'Cabang tidak dapat diakses' USING ERRCODE='42501'; END IF;
 END IF;
 -- Clock and changes are read in ONE statement/snapshot. Return only IDs, never row contents.
 WITH delta AS (
  SELECT d.table_name,d.row_id FROM public.printex_row_changes d
  WHERE p_after IS NOT NULL AND d.revision>p_after
   AND (NOT branch_mode OR p_branch IS NULL OR d.branch_key=p_branch::text OR d.table_name='production_steps')
  LIMIT 2001
 ), summary AS (SELECT count(*) AS n FROM delta)
 SELECT jsonb_build_object('cursor',c.revision::text,'reset',summary.n>2000,'changes',
  CASE WHEN p_after IS NULL OR summary.n>2000 THEN '[]'::jsonb
  ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('table',d.table_name,'id',d.row_id)) FROM delta d),'[]'::jsonb) END)
 INTO result FROM public.printex_sync_clock c CROSS JOIN summary WHERE singleton;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.printex_sync_changes(bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_sync_changes(bigint,uuid) TO authenticated;
COMMIT;
