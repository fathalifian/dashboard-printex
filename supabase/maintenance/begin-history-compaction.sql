-- Caller holds business-table locks and the report-worker advisory lock.
-- Avoid repeatedly updating the same sync clock inside one large transaction.
CREATE TEMP TABLE printex_history_before_ids ON COMMIT DROP AS
SELECT id,coalesce(branch_id::text,'') AS branch_key FROM public.process_history;
ALTER TABLE public.process_history DISABLE TRIGGER printex_track_change;
ALTER TABLE public.process_history DISABLE TRIGGER history_queue_report;
