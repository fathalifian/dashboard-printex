-- Run after 0030. Merge only an unambiguous exit/entry with matching metadata.
-- The entry ID remains next_event_id so expanded dashboard history is identical.
CREATE TEMP TABLE printex_compact_pairs ON COMMIT DROP AS
WITH unique_times AS (
 SELECT order_identity,occurred_at FROM public.process_history
 GROUP BY order_identity,occurred_at
 HAVING count(*) FILTER(WHERE event_kind='entered')=1
 AND count(*) FILTER(WHERE event_kind IN ('completed','returned'))=1
)
SELECT x.id AS exit_id,e.id AS entry_id,e.step_id
FROM unique_times t JOIN public.process_history x USING(order_identity,occurred_at)
JOIN public.process_history e
 ON e.order_identity=x.order_identity AND e.occurred_at=x.occurred_at
 AND e.event_kind='entered' AND x.event_kind IN ('completed','returned')
 AND e.customer_name IS NOT DISTINCT FROM x.customer_name
 AND e.spk_code=x.spk_code AND e.branch_id IS NOT DISTINCT FROM x.branch_id
WHERE x.next_step_id IS NULL AND e.next_step_id IS NULL;
UPDATE public.process_history h SET next_step_id=p.step_id,next_event_id=p.entry_id
FROM printex_compact_pairs p WHERE h.id=p.exit_id;
DELETE FROM public.process_history h USING printex_compact_pairs p WHERE h.id=p.entry_id;
