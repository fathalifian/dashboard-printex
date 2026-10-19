-- A stock shortcut may have no link yet (the button then shows "Link belum diatur"). Safe to rerun.
ALTER TABLE public.stock_shortcuts DROP CONSTRAINT IF EXISTS stock_shortcuts_url_check;
ALTER TABLE public.stock_shortcuts ADD CONSTRAINT stock_shortcuts_url_check
 CHECK (url = '' OR (length(url) <= 2048 AND url ~ '^https://[^[:space:]]+$'));
