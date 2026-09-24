-- Shared WhatsApp contact. Requires migration 0013. Safe to run again.
BEGIN;
CREATE TABLE IF NOT EXISTS public.customer_service_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  whatsapp_number text NOT NULL DEFAULT ''
    CHECK (whatsapp_number = '' OR whatsapp_number ~ '^[1-9][0-9]{7,14}$')
);
INSERT INTO public.customer_service_settings(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.customer_service_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_service_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_service_settings TO authenticated;
GRANT UPDATE (whatsapp_number) ON public.customer_service_settings TO authenticated;

DROP POLICY IF EXISTS customer_service_read ON public.customer_service_settings;
CREATE POLICY customer_service_read ON public.customer_service_settings
FOR SELECT TO authenticated USING (public.printex_staff());
DROP POLICY IF EXISTS customer_service_update ON public.customer_service_settings;
CREATE POLICY customer_service_update ON public.customer_service_settings
FOR UPDATE TO authenticated USING (public.printex_admin()) WITH CHECK (public.printex_admin());
COMMIT;
