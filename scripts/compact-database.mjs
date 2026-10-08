import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'

// Explicitly mutating entry point. Read-only inspection is audit-database-size.mjs.
if(!process.argv.includes('--execute'))throw Error('Requires --execute. Use audit-database-size.mjs for a read-only audit.')
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const url=new URL(process.env.SUPABASE_DB_URL),project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if(!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith(`.${project}`))))throw Error('Database project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const directory=`build/backups/database-compaction-${new Date().toISOString().replace(/[:.]/g,'-')}`
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex')
const historyHash=rows=>hash(rows.flatMap(h=>{
 const e={id:h.id,order:h.order_identity,spk:h.spk_code,step:h.step_id,kind:h.event_kind,at:new Date(h.occurred_at).toISOString(),customer:h.customer_name,branch:h.branch_id}
 return h.next_step_id?[e,{...e,id:h.next_event_id,step:h.next_step_id,kind:'entered'}]:[e]
}).sort((a,b)=>a.id.localeCompare(b.id)))
async function fingerprints(){
 const result={}
 for(const table of ['orders','customers','profiles','branches','production_steps'])result[table]=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM public.${table} t`)).rows[0]
 return result
}
async function reportHash(){
 const compact=(await db.query("SELECT to_regclass('public.printex_report_expanded') IS NOT NULL AS active")).rows[0].active
 const source=compact?'printex_report_expanded':'report_contributions'
 return (await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(jsonb_build_object(
 'order_id',order_id,'branch_id',branch_id,'report_date',report_date,'metric',metric,'dimension',dimension,'meter',meter,'milliseconds',milliseconds,
 'data',CASE WHEN data ? 'event' THEN jsonb_set(data,'{event,actorName}','null'::jsonb) ELSE data END)::text),'' ORDER BY order_id,report_date,metric,dimension),'')) AS hash FROM public.${source}`)).rows[0]
}
const summaryHash=async()=>hash((await db.query('SELECT * FROM public.report_daily_summaries ORDER BY branch_id,report_date,metric,dimension')).rows)
const sizes=async()=> (await db.query(`SELECT relname,pg_total_relation_size(relid)::text AS bytes FROM pg_stat_user_tables
 WHERE schemaname='public' AND relname IN ('process_history','report_contributions','report_order_payloads','printex_row_changes','report_daily_summaries') ORDER BY relname`)).rows
try{
 await db.connect()
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
 await db.query("SET LOCAL statement_timeout='180s'; SET LOCAL lock_timeout='5s'")
 await db.query('SELECT pg_advisory_xact_lock(73621,1)')
 await db.query('LOCK TABLE public.orders,public.customers,public.profiles,public.branches,public.production_steps,public.process_history,public.report_contributions,public.report_daily_summaries,public.report_refresh_queue,public.printex_row_changes,public.printex_sync_clock IN SHARE ROW EXCLUSIVE MODE')
 console.log(JSON.stringify({stage:'backup-and-fingerprints'}))
 const history=(await db.query('SELECT * FROM public.process_history ORDER BY id')).rows
 const queueHash=async()=>hash((await db.query('SELECT * FROM public.report_refresh_queue ORDER BY order_id')).rows)
 const before={business:await fingerprints(),history:historyHash(history),reports:await reportHash(),summaries:await summaryHash(),queue:await queueHash(),sizes:await sizes()}
 mkdirSync(directory,{recursive:true})
 const save=(name,data)=>writeFileSync(`${directory}/${name}.json`,JSON.stringify(data),{mode:0o600})
 save('before',before);save('history-before',history)
 for(const table of ['report_contributions','report_daily_summaries','report_refresh_queue','printex_row_changes'])save(table,(await db.query(`SELECT * FROM public.${table}`)).rows)
 if((await db.query("SELECT to_regclass('public.report_order_payloads') IS NOT NULL AS present")).rows[0].present)save('report_order_payloads',(await db.query('SELECT * FROM public.report_order_payloads')).rows)
 save('functions-before',(await db.query("SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'")).rows)
 save('indexes-before',(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'")).rows)
 for(const file of ['supabase/maintenance/begin-history-compaction.sql','supabase/migrations/0030_history_without_actors.sql','supabase/maintenance/compact-history.sql','supabase/maintenance/end-history-compaction.sql','supabase/report-migrations/0002_compact_payloads.sql']){
  console.log(JSON.stringify({stage:'migration',file}))
  await db.query(readFileSync(file,'utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''))
 }
 console.log(JSON.stringify({stage:'preservation-checks'}))
 const afterHistory=(await db.query('SELECT * FROM public.process_history ORDER BY id')).rows
 const after={business:await fingerprints(),history:historyHash(afterHistory),reports:await reportHash(),summaries:await summaryHash(),queue:await queueHash()}
 if(JSON.stringify(before.business)!==JSON.stringify(after.business)||before.history!==after.history||JSON.stringify(before.reports)!==JSON.stringify(after.reports)||before.summaries!==after.summaries||before.queue!==after.queue)throw Error('Preservation check failed; refusing commit')
 const missing=(await db.query(`SELECT count(*)::int AS n FROM printex_history_before_ids p
 LEFT JOIN public.process_history h ON h.id=p.id
 LEFT JOIN public.printex_row_changes d ON d.table_name='process_history' AND d.row_id=p.id AND d.branch_key=p.branch_key
 WHERE d.row_id IS NULL OR d.deleted IS DISTINCT FROM (h.id IS NULL)
 OR d.revision<>(SELECT revision FROM public.printex_sync_clock WHERE singleton)`)).rows[0].n
 if(missing)throw Error('History sync markers missing; refusing commit')
 if(afterHistory.some(h=>h.actor_id!==null||h.actor_name!==null||h.assigned_employee_id!==null))throw Error('Actor metadata remains; refusing commit')
 await db.query('COMMIT')
 const result={committed:true,backup:directory,historyBefore:history.length,historyAfter:afterHistory.length,businessAndReportResultsPreserved:true,syncMarkersVerified:true,reportQueuePreserved:true,actorMetadataRemoved:true,reclaimed:false}
 save('after',result)
 console.log(JSON.stringify(result))
 if(process.argv.includes('--reclaim')){
  // Separate maintenance statements: commit above has already succeeded.
  await db.query("SET lock_timeout='5s'; SET statement_timeout='180s'")
  for(const table of ['process_history','report_contributions','printex_row_changes','report_order_payloads']){
   console.log(JSON.stringify({reclaiming:table}))
   await db.query(`VACUUM (FULL, ANALYZE) public.${table}`)
  }
  result.reclaimed=true;result.sizesBefore=before.sizes;result.sizesAfter=await sizes()
  save('after',result);console.log(JSON.stringify(result))
 }
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:error.code??'COMPACTION_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message.slice(0,300),backup:directory}));process.exitCode=1}finally{await db.end()}
