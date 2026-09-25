-- Extend shortcut editing to active Owner accounts. Requires migration 0017.
BEGIN;
DROP POLICY IF EXISTS stock_shortcuts_edit ON public.stock_shortcuts;
CREATE POLICY stock_shortcuts_edit ON public.stock_shortcuts FOR UPDATE TO authenticated
USING(public.printex_admin()) WITH CHECK(public.printex_admin());
COMMIT;
