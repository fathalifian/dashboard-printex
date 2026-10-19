-- Pengaturan bersama yang diubah Owner/Admin: tombol link stok di Board Produksi dan nomor Customer Service.

-- Link kosong = tombol nonaktif. version dipakai untuk penguncian optimistis dari aplikasi.
CREATE TABLE public.stock_shortcuts (
  id text PRIMARY KEY CHECK (id IN ('dtf_paper','fabric')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  url text NOT NULL CHECK (url='' OR (length(url)<=2048 AND url ~ '^https://[^[:space:]]+$')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO public.stock_shortcuts(id,label,url) VALUES
  ('dtf_paper','Stock DTF dan Kertas','https://docs.google.com/spreadsheets/d/1qSXiNUIUOmJ_yPmtpB8CLEEk2OZCHMRkhH7m6b1NPM8/edit?gid=143541986#gid=143541986'),
  ('fabric','Stock Kain','https://docs.google.com/spreadsheets/d/1Ipag7VfEh8yyEBjhU52dL0TlE9bfh4lhcwow8CZ_HJA/edit?gid=255000558#gid=255000558');
ALTER TABLE public.stock_shortcuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_shortcuts_read ON public.stock_shortcuts FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY stock_shortcuts_edit ON public.stock_shortcuts FOR UPDATE TO authenticated
  USING (public.printex_admin()) WITH CHECK (public.printex_admin());

-- Nomor WhatsApp Customer Service (format internasional tanpa +, atau kosong).
CREATE TABLE public.customer_service_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  whatsapp_number text NOT NULL DEFAULT '' CHECK (whatsapp_number='' OR whatsapp_number ~ '^[1-9][0-9]{7,14}$')
);
INSERT INTO public.customer_service_settings(singleton) VALUES (true);
ALTER TABLE public.customer_service_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_service_read ON public.customer_service_settings FOR SELECT TO authenticated USING (public.printex_staff());
CREATE POLICY customer_service_update ON public.customer_service_settings FOR UPDATE TO authenticated
  USING (public.printex_admin()) WITH CHECK (public.printex_admin());
