-- Load active production plus only the orders needed by the selected period.
-- Keep each selected order's complete history so revisits and original milestones
-- retain their existing reporting semantics. RLS applies to every source table.
BEGIN;
CREATE INDEX IF NOT EXISTS orders_finalized_at_scope ON public.orders(archive_finalized_at);
CREATE INDEX IF NOT EXISTS orders_order_date_scope ON public.orders(order_date);
CREATE INDEX IF NOT EXISTS process_history_scope_time ON public.process_history(occurred_at,order_identity);
CREATE INDEX IF NOT EXISTS process_history_scope_identity ON public.process_history(order_identity);

DROP FUNCTION IF EXISTS public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb,uuid,boolean,text[]);
CREATE FUNCTION public.printex_scoped_snapshot(
 p_start date, p_end date, p_branch uuid DEFAULT NULL,
 p_order uuid DEFAULT NULL, p_changes jsonb DEFAULT NULL,
 p_history_after uuid DEFAULT NULL,p_history_only boolean DEFAULT false,p_history_ids text[] DEFAULT NULL
) RETURNS json LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE branch_mode boolean; result json; branch_order text; branch_history text; history_branch_field text; history_branch_column text;
BEGIN
 IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>365 THEN
  RAISE EXCEPTION 'Rentang data tidak valid';
 END IF;
 branch_mode := to_regclass('public.branches') IS NOT NULL;
 branch_order := CASE WHEN branch_mode THEN ' AND ($3 IS NULL OR o.branch_id=$3)' ELSE '' END;
 branch_history := CASE WHEN branch_mode THEN ' AND ($3 IS NULL OR h.branch_id=$3)' ELSE '' END;
 history_branch_field := CASE WHEN branch_mode THEN ', ''branch_id'',h.branch_id' ELSE '' END;
 history_branch_column := CASE WHEN branch_mode THEN ',h.branch_id' ELSE '' END;
 EXECUTE '
 WITH selected_identity AS MATERIALIZED (
  SELECT unnest($8::text[]) AS identity WHERE $8 IS NOT NULL
  UNION
  SELECT o.id::text AS identity FROM public.orders o WHERE $8 IS NULL AND
   (o.archive_finalized_at IS NULL OR o.order_date BETWEEN $1 AND $2
    OR o.archive_finalized_at >= ($1::timestamp AT TIME ZONE ''Asia/Jakarta'')
       AND o.archive_finalized_at < (($2+1)::timestamp AT TIME ZONE ''Asia/Jakarta'')
    OR o.id=$4)' || branch_order || '
  UNION
  SELECT h.order_identity FROM public.process_history h WHERE $8 IS NULL AND
   h.occurred_at >= ($1::timestamp AT TIME ZONE ''Asia/Jakarta'')
   AND h.occurred_at < (($2+1)::timestamp AT TIME ZONE ''Asia/Jakarta'')' || branch_history || '
 ), selected_orders AS MATERIALIZED (
  SELECT o.id,o.customer_id FROM public.orders o JOIN selected_identity i ON i.identity=o.id::text
  WHERE true' || branch_order || '
 ), changed AS MATERIALIZED (
  SELECT item->>''table'' AS table_name,item->>''id'' AS id
  FROM jsonb_array_elements(coalesce($5,''[]''::jsonb)) item
 ), history_page AS MATERIALIZED (
  SELECT h.id,h.order_identity,h.spk_code,h.step_id,h.event_kind,h.occurred_at,h.actor_name,h.customer_name' || history_branch_column || '
  FROM public.process_history h JOIN selected_identity i ON i.identity=h.order_identity
  WHERE ($6 IS NULL OR h.id>$6)' || branch_history || '
   AND ($5 IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name=''process_history'' AND c.id=h.id::text))
  ORDER BY h.id LIMIT 5001
 ), history_rows AS MATERIALIZED (SELECT * FROM history_page ORDER BY id LIMIT 5000)
 SELECT json_build_object(
  ''orders'',CASE WHEN $7 THEN ''[]''::json ELSE coalesce((SELECT json_agg(row_to_json(o)) FROM public.orders o JOIN selected_orders s ON s.id=o.id
   WHERE $5 IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name=''orders'' AND c.id=o.id::text)),''[]''::json) END,
  ''customers'',CASE WHEN $7 THEN ''[]''::json ELSE coalesce((SELECT json_agg(json_build_object(''id'',t.id,''name'',t.name,''phone'',t.phone)) FROM public.customers t
   WHERE EXISTS(SELECT 1 FROM selected_orders o WHERE o.customer_id=t.id)
   AND ($5 IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name=''customers'' AND c.id=t.id::text))),''[]''::json) END,
  ''production_steps'',CASE WHEN $7 THEN ''[]''::json ELSE coalesce((SELECT json_agg(json_build_object(''id'',t.id,''code'',t.code)) FROM public.production_steps t
   WHERE $5 IS NULL OR EXISTS(SELECT 1 FROM changed c WHERE c.table_name=''production_steps'' AND c.id=t.id::text)),''[]''::json) END,
  ''process_history'',coalesce((SELECT json_agg(json_build_object(
   ''id'',h.id,''order_identity'',h.order_identity,''spk_code'',h.spk_code,''step_id'',h.step_id,
   ''event_kind'',h.event_kind,''occurred_at'',h.occurred_at,''actor_name'',h.actor_name,
   ''customer_name'',h.customer_name' || history_branch_field || ')) FROM history_rows h),''[]''::json),
  ''history_more'',(SELECT count(*)>5000 FROM history_page),
  ''history_cursor'',(SELECT id FROM history_rows ORDER BY id DESC LIMIT 1),
  ''identities'',CASE WHEN $7 THEN ''[]''::json ELSE coalesce((SELECT json_agg(identity) FROM selected_identity),''[]''::json) END
 )' INTO result USING p_start,p_end,p_branch,p_order,p_changes,p_history_after,p_history_only,p_history_ids;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb,uuid,boolean,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.printex_scoped_snapshot(date,date,uuid,uuid,jsonb,uuid,boolean,text[]) TO authenticated;
COMMIT;
