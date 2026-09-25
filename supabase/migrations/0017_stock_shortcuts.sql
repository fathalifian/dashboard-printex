-- Shared production board shortcuts. Only the exact Admin role may edit.
BEGIN;
CREATE TABLE IF NOT EXISTS public.stock_shortcuts (
  id text PRIMARY KEY CHECK (id IN ('dtf_paper','fabric')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  url text NOT NULL CHECK (length(url)<=2048 AND url ~ '^https://[^[:space:]]+$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0)
);
INSERT INTO public.stock_shortcuts(id,label,url) VALUES
('dtf_paper','Stock DTF dan Kertas','https://docs.google.com/spreadsheets/d/1qSXiNUIUOmJ_yPmtpB8CLEEk2OZCHMRkhH7m6b1NPM8/edit?gid=143541986#gid=143541986'),
('fabric','Stock Kain','https://docs.google.com/spreadsheets/d/1Ipag7VfEh8yyEBjhU52dL0TlE9bfh4lhcwow8CZ_HJA/edit?gid=255000558#gid=255000558')
ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.stock_shortcuts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_shortcuts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_shortcuts TO authenticated;
GRANT UPDATE (label,url,version) ON public.stock_shortcuts TO authenticated;
DROP POLICY IF EXISTS stock_shortcuts_read ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_read ON public.stock_shortcuts FOR SELECT TO authenticated USING(public.printex_staff());
DROP POLICY IF EXISTS stock_shortcuts_edit ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_edit ON public.stock_shortcuts FOR UPDATE TO authenticated
USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='admin'))
WITH CHECK(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='admin'));
COMMIT;
