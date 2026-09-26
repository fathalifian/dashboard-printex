BEGIN;
CREATE OR REPLACE FUNCTION public.printex_online_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schema_version',8,'branches_enabled',true,'branch_settings_enabled',true,'incremental_sync_enabled',true,'branch_schema_version',4,'realtime_tables',
 (SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;
COMMIT;
