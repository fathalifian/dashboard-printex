import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const url=new URL(process.env.SUPABASE_DB_URL),project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if(!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith(`.${project}`))))throw Error('Database project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
try{
 await db.connect()
 await db.query('BEGIN READ ONLY')
 await db.query("SET LOCAL statement_timeout='60s'")
 const sizes=(await db.query(`SELECT c.relname,c.relkind,pg_relation_size(c.oid)::text AS bytes
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 AND (c.relname LIKE 'report_%' OR c.relname LIKE 'process_history%' OR c.relname LIKE 'printex_%') ORDER BY pg_relation_size(c.oid) DESC`)).rows
 const history=(await db.query(`SELECT count(*)::int AS rows,count(*) FILTER(WHERE actor_id IS NOT NULL OR actor_name IS NOT NULL OR assigned_employee_id IS NOT NULL)::int AS actor_rows,
 count(*) FILTER(WHERE next_step_id IS NOT NULL)::int AS compact_rows FROM process_history`)).rows[0]
 const payload=(await db.query(`SELECT count(*)::int AS rows,count(DISTINCT order_id)::int AS orders,
 sum(pg_column_size(data))::text AS payload_bytes,
 sum(pg_column_size(data->'order')) FILTER(WHERE data ? 'order' AND data->'order'<>'null'::jsonb)::text AS repeated_order_bytes,
 count(*) FILTER(WHERE data ? 'order' AND data->'order'<>'null'::jsonb)::int AS order_copies,
 count(*) FILTER(WHERE data ? 'order')::int AS order_references FROM report_contributions`)).rows[0]
 const conflicts=(await db.query(`SELECT count(*)::int AS n FROM (SELECT order_id FROM report_contributions WHERE data ? 'order' GROUP BY order_id HAVING count(DISTINCT data->'order')>1) t`)).rows[0].n
 const stats=(await db.query(`SELECT relname,n_live_tup,n_dead_tup FROM pg_stat_user_tables WHERE relname IN ('process_history','report_contributions','printex_row_changes')`)).rows
 const sync=(await db.query('SELECT count(*)::int AS rows,count(*) FILTER(WHERE deleted)::int AS tombstones FROM printex_row_changes')).rows[0]
 const triggers=(await db.query(`SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='public.process_history'::regclass AND tgname IN ('history_no_actor','history_queue_report','printex_track_change') ORDER BY tgname`)).rows
 const compact=(await db.query("SELECT to_regclass('public.report_order_payloads') IS NOT NULL AS present")).rows[0].present
 const snapshots=compact?(await db.query('SELECT count(*)::int AS rows,sum(pg_column_size(data))::text AS payload_bytes FROM report_order_payloads')).rows[0]:null
 await db.query('ROLLBACK')
 console.log(JSON.stringify({readOnly:true,sizes,history,payload,conflictingOrderSnapshots:conflicts,stats,sync,triggers,snapshots},null,2))
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:error.code??'AUDIT_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message.slice(0,300)}));process.exitCode=1}finally{await db.end()}
