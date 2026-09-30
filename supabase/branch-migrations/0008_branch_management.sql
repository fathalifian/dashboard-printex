-- Branch lifecycle within the existing project. Files are removed via Storage API.
BEGIN;
CREATE TABLE IF NOT EXISTS public.branch_deletions (
 branch_id uuid PRIMARY KEY REFERENCES public.branches(id),
 photo_paths jsonb NOT NULL DEFAULT '[]', user_ids jsonb NOT NULL DEFAULT '[]'
);
ALTER TABLE public.branch_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_deletions FROM PUBLIC,anon,authenticated;

-- Serialize new writes with branch retirement. Existing profile deactivation remains possible.
CREATE OR REPLACE FUNCTION public.printex_require_active_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.branch_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='profiles' AND TG_OP='UPDATE' THEN
   IF NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id AND NOT NEW.is_active THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM public.branches WHERE id=NEW.branch_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cabang tidak aktif atau sedang dihapus'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.printex_require_active_branch() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','customers','profiles'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS require_active_branch ON public.%I',t);
  EXECUTE format('CREATE TRIGGER require_active_branch BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.printex_require_active_branch()',t);
 END LOOP;
END $$;

-- An upload already in flight must finish before retirement, or fail afterward.
CREATE OR REPLACE FUNCTION public.printex_upload_active_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE branch uuid;
BEGIN
 IF NEW.bucket_id <> 'order-photos' THEN RETURN NEW; END IF;
 SELECT branch_id INTO branch FROM public.orders WHERE id::text=split_part(NEW.name,'/',1);
 IF branch IS NULL THEN RAISE EXCEPTION 'Order foto tidak ditemukan'; END IF;
 IF branch IS NOT NULL THEN
  PERFORM 1 FROM public.branches WHERE id=branch AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cabang tidak aktif atau sedang dihapus'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.printex_upload_active_branch() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS printex_upload_active_branch ON storage.objects;
CREATE TRIGGER printex_upload_active_branch BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.printex_upload_active_branch();

CREATE OR REPLACE FUNCTION public.printex_manage_branch(p_action text,p_id uuid DEFAULT NULL,p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.branches; job public.branch_deletions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('printex-user-management',0));
 PERFORM 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='central_owner' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Hanya Owner Pusat yang dapat mengelola cabang' USING ERRCODE='42501'; END IF;
 IF p_action='list' THEN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'deleting',EXISTS(SELECT 1 FROM public.branch_deletions d WHERE d.branch_id=branches.id)) ORDER BY name),'[]') FROM public.branches);
 END IF;
 IF p_action NOT IN ('create','rename','prepare_delete','finish_delete') OR p_action IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Aksi cabang tidak valid'; END IF;
 IF p_action IN ('create','rename') AND (p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION 'Nama cabang harus 1?100 karakter'; END IF;
 IF p_action='create' THEN
  IF EXISTS(SELECT 1 FROM public.branches WHERE id=p_id AND name=trim(p_name) AND is_active) THEN RETURN '{}'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.branches WHERE lower(name)=lower(trim(p_name))) THEN RAISE EXCEPTION 'Nama cabang sudah digunakan'; END IF;
  INSERT INTO public.branches(id,name) VALUES(p_id,trim(p_name));
  RETURN '{}'::jsonb;
 END IF;
 SELECT * INTO b FROM public.branches WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_action IN ('prepare_delete','finish_delete') THEN RETURN jsonb_build_object('photo_paths','[]'::jsonb,'user_ids','[]'::jsonb); END IF;
  RAISE EXCEPTION 'Cabang tidak ditemukan';
 END IF;
 IF p_action='rename' THEN
  IF NOT b.is_active THEN RAISE EXCEPTION 'Cabang sedang dihapus'; END IF;
  IF EXISTS(SELECT 1 FROM public.branches WHERE id<>p_id AND lower(name)=lower(trim(p_name))) THEN RAISE EXCEPTION 'Nama cabang sudah digunakan'; END IF;
  UPDATE public.branches SET name=trim(p_name) WHERE id=p_id;
  RETURN '{}'::jsonb;
 END IF;
 IF p_name IS DISTINCT FROM b.name THEN RAISE EXCEPTION 'Nama konfirmasi tidak cocok. Muat ulang daftar cabang'; END IF;
 SELECT * INTO job FROM public.branch_deletions WHERE branch_id=p_id;
 IF p_action='prepare_delete' THEN
  IF job.branch_id IS NULL THEN
   INSERT INTO public.branch_deletions(branch_id,photo_paths,user_ids)
   SELECT p_id,
    (SELECT coalesce(jsonb_agg(s.name),'[]') FROM storage.objects s WHERE s.bucket_id='order-photos' AND (
      EXISTS(SELECT 1 FROM public.orders o WHERE o.branch_id=p_id AND (o.id::text=split_part(s.name,'/',1) OR o.photo_path=s.name))
      OR EXISTS(SELECT 1 FROM public.order_photo_cleanup q WHERE q.branch_id=p_id AND q.path=s.name))),
    (SELECT coalesce(jsonb_agg(id),'[]') FROM public.profiles WHERE branch_id=p_id AND role<>'central_owner')
   RETURNING * INTO job;
   UPDATE public.profiles SET branch_id=NULL WHERE branch_id=p_id AND role='central_owner';
   UPDATE public.profiles SET is_active=false,deletion_requested_at=now() WHERE branch_id=p_id;
   UPDATE public.branches SET is_active=false WHERE id=p_id;
   -- Remove order references before Auth deletion invokes profile FK SET NULL actions.
   -- The durable manifest retains every file and account required for cleanup retries.
   DELETE FROM public.production_schedules ps
    WHERE EXISTS(SELECT 1 FROM public.schedule_items si JOIN public.orders o ON o.id=si.order_id WHERE si.schedule_id=ps.id AND o.branch_id=p_id)
    AND NOT EXISTS(SELECT 1 FROM public.schedule_items si JOIN public.orders o ON o.id=si.order_id WHERE si.schedule_id=ps.id AND o.branch_id<>p_id);
   DELETE FROM public.schedule_items WHERE order_id IN (SELECT id FROM public.orders WHERE branch_id=p_id);
   DELETE FROM public.process_history WHERE branch_id=p_id;
   DELETE FROM public.orders WHERE branch_id=p_id;
   DELETE FROM public.customers WHERE branch_id=p_id;
  END IF;
  RETURN jsonb_build_object('photo_paths',job.photo_paths,'user_ids',job.user_ids);
 END IF;
 IF job.branch_id IS NULL THEN RAISE EXCEPTION 'Mulai penghapusan cabang terlebih dahulu'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND job.photo_paths ? s.name) THEN RAISE EXCEPTION 'File cabang belum selesai dihapus. Coba lagi'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users u WHERE job.user_ids ? u.id::text) THEN RAISE EXCEPTION 'Akun cabang belum selesai dihapus. Coba lagi'; END IF;
 DELETE FROM public.schedule_items WHERE order_id IN (SELECT id FROM public.orders WHERE branch_id=p_id);
 DELETE FROM public.process_history WHERE branch_id=p_id;
 DELETE FROM public.orders WHERE branch_id=p_id;
 DELETE FROM public.customers WHERE branch_id=p_id;
 DELETE FROM public.order_photo_cleanup WHERE branch_id=p_id OR job.photo_paths ? path;
 DELETE FROM public.branch_customer_service_settings WHERE branch_id=p_id;
 DELETE FROM public.branch_stock_shortcuts WHERE branch_id=p_id;
 -- Keep sync tombstones so other central-owner devices remove cached branch rows.
 DELETE FROM public.branch_deletions WHERE branch_id=p_id;
 DELETE FROM public.branches WHERE id=p_id;
 RETURN '{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.printex_manage_branch(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_manage_branch(text,uuid,text) TO authenticated;
COMMIT;
