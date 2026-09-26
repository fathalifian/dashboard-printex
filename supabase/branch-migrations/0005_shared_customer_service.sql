-- One support team for all branches. Preserve existing shared contact and legacy branch rows.
BEGIN;
INSERT INTO public.customer_service_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
-- Keep the former shared number. Branch-specific numbers are not chosen automatically.
ALTER TABLE public.customer_service_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_service_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customer_service_settings TO authenticated;
GRANT UPDATE(whatsapp_number) ON public.customer_service_settings TO authenticated;
DROP POLICY IF EXISTS customer_service_read ON public.customer_service_settings;
CREATE POLICY customer_service_read ON public.customer_service_settings FOR SELECT TO authenticated USING(public.printex_staff());
DROP POLICY IF EXISTS customer_service_update ON public.customer_service_settings;
CREATE POLICY customer_service_update ON public.customer_service_settings FOR UPDATE TO authenticated
 USING(public.printex_admin()) WITH CHECK(public.printex_admin());
REVOKE ALL ON public.branch_customer_service_settings FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.printex_initialize_branch_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.branch_stock_shortcuts(branch_id,id,label) VALUES
 (NEW.id,'dtf_paper','Stock DTF dan Kertas'),(NEW.id,'fabric','Stock Kain') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
COMMIT;
