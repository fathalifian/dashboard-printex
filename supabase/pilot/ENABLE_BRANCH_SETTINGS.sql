-- Run after SETUP_TWO_BRANCHES.sql and ENABLE_BRANCH_OWNER_USERS.sql.
-- Existing shared settings remain preserved in their legacy tables.
BEGIN;
CREATE TABLE IF NOT EXISTS public.branch_customer_service_settings (
 branch_id uuid PRIMARY KEY REFERENCES public.branches(id),
 whatsapp_number text NOT NULL DEFAULT '' CHECK (whatsapp_number='' OR whatsapp_number ~ '^[1-9][0-9]{7,14}$')
);
CREATE TABLE IF NOT EXISTS public.branch_stock_shortcuts (
 branch_id uuid NOT NULL REFERENCES public.branches(id),
 id text NOT NULL CHECK (id IN ('dtf_paper','fabric')),
 label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
 url text NOT NULL DEFAULT '' CHECK (url='' OR (length(url)<=2048 AND url ~ '^https://[^[:space:]]+$')),
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 PRIMARY KEY(branch_id,id)
);
CREATE OR REPLACE FUNCTION public.printex_initialize_branch_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.branch_customer_service_settings(branch_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 INSERT INTO public.branch_stock_shortcuts(branch_id,id,label) VALUES
 (NEW.id,'dtf_paper','Stock DTF dan Kertas'),(NEW.id,'fabric','Stock Kain') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.printex_initialize_branch_settings() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS initialize_branch_settings ON public.branches;
CREATE TRIGGER initialize_branch_settings AFTER INSERT ON public.branches FOR EACH ROW EXECUTE FUNCTION public.printex_initialize_branch_settings();
INSERT INTO public.branch_customer_service_settings(branch_id) SELECT id FROM public.branches ON CONFLICT DO NOTHING;
INSERT INTO public.branch_stock_shortcuts(branch_id,id,label)
 SELECT b.id,s.id,s.label FROM public.branches b CROSS JOIN
 (VALUES ('dtf_paper','Stock DTF dan Kertas'),('fabric','Stock Kain')) s(id,label) ON CONFLICT DO NOTHING;
ALTER TABLE public.branch_customer_service_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_stock_shortcuts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_customer_service_settings,public.branch_stock_shortcuts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.branch_customer_service_settings,public.branch_stock_shortcuts TO authenticated;
GRANT UPDATE(whatsapp_number) ON public.branch_customer_service_settings TO authenticated;
GRANT UPDATE(label,url,version) ON public.branch_stock_shortcuts TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['branch_customer_service_settings','branch_stock_shortcuts'] LOOP
 EXECUTE format('DROP POLICY IF EXISTS branch_settings_read ON public.%I',t);
 EXECUTE format('CREATE POLICY branch_settings_read ON public.%I FOR SELECT TO authenticated USING(public.printex_branch_access(branch_id))',t);
 EXECUTE format('DROP POLICY IF EXISTS branch_settings_write ON public.%I',t);
 EXECUTE format('CREATE POLICY branch_settings_write ON public.%I FOR UPDATE TO authenticated USING(public.printex_branch_access(branch_id) AND public.printex_admin()) WITH CHECK(public.printex_branch_access(branch_id) AND public.printex_admin())',t);
 END LOOP;
END $$;
-- Block the former shared endpoints, including direct requests from old clients.
REVOKE ALL ON public.customer_service_settings,public.stock_shortcuts FROM authenticated,anon;
COMMIT;
