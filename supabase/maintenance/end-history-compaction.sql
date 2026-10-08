-- Every original ID receives the same committed revision, including deleted
-- entry rows. Existing tombstones and changes in other tables are untouched.
WITH clock AS (
 UPDATE public.printex_sync_clock SET revision=revision+1
 WHERE singleton RETURNING revision
)
INSERT INTO public.printex_row_changes(table_name,row_id,branch_key,revision,deleted)
SELECT 'process_history',p.id,p.branch_key,c.revision,h.id IS NULL
FROM printex_history_before_ids p CROSS JOIN clock c
LEFT JOIN public.process_history h ON h.id=p.id
ON CONFLICT(table_name,row_id,branch_key) DO UPDATE
SET revision=excluded.revision,deleted=excluded.deleted;
ALTER TABLE public.process_history ENABLE TRIGGER printex_track_change;
ALTER TABLE public.process_history ENABLE TRIGGER history_queue_report;
