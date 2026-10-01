-- allRows uses WHERE branch_id = ? [AND id > ?] ORDER BY id LIMIT 1000.
-- Existing branch/date indexes cannot provide that ordering. Primary keys still
-- serve all-branch reads and incremental WHERE id IN (...) lookups.
CREATE INDEX IF NOT EXISTS orders_branch_id_page ON public.orders(branch_id,id);
CREATE INDEX IF NOT EXISTS customers_branch_id_page ON public.customers(branch_id,id);
CREATE INDEX IF NOT EXISTS history_branch_id_page ON public.process_history(branch_id,id);
