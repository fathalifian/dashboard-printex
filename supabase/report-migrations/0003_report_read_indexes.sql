-- Match queue draining and report pagination order. No business rows are modified.
BEGIN;
CREATE INDEX IF NOT EXISTS report_queue_oldest ON public.report_refresh_queue(queued_at,order_id);
CREATE INDEX IF NOT EXISTS report_queue_branch_oldest ON public.report_refresh_queue(branch_id,queued_at,order_id);
CREATE INDEX IF NOT EXISTS report_details_branch_page ON public.report_contributions(branch_id,metric,dimension,report_date DESC,order_id);
CREATE INDEX IF NOT EXISTS report_details_all_page ON public.report_contributions(metric,dimension,report_date DESC,order_id);
COMMIT;
