import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const url=new URL(process.env.SUPABASE_DB_URL)
if(!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith(`.${project}`))))throw Error('Database project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const directory=`build/backups/compact-transitions-${new Date().toISOString().replace(/[:.]/g,'-')}`
function logical(rows){
 const events=rows.flatMap(row=>{
  const event={id:row.id,order:row.order_identity,spk:row.spk_code,step:row.step_id,kind:row.event_kind,at:new Date(row.occurred_at).toISOString(),actor:row.actor_name,customer:row.customer_name,branch:row.branch_id??null}
  return row.next_step_id?[event,{...event,id:row.next_event_id,step:row.next_step_id,kind:'entered'}]:[event]
 }).sort((a,b)=>a.id.localeCompare(b.id))
 return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}
async function fingerprints(){const result={};for(const table of ['orders','customers','profiles','branches','production_steps'])result[table]=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM public.${table} t`)).rows[0];return result}
try{
 await db.connect()
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
 await db.query("SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'")
 if(process.argv.includes('--schema-only') || process.argv.includes('--read-optimization-only') || process.argv.includes('--manual-spk-only')){
  const before=await fingerprints()
  const original=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  mkdirSync(directory,{recursive:true})
  const functions=(await db.query("SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('capture_process_history','enforce_order_archiving','printex_scoped_snapshot','printex_mutate_order')")).rows
  writeFileSync(`${directory}/schema-before.json`,JSON.stringify({before,functions},null,2),{mode:0o600})
  const migration=process.argv.includes('--manual-spk-only')?'0029_manual_spk_on_create.sql':process.argv.includes('--read-optimization-only')?'0028_skip_archive_process_reads.sql':'0027_compact_transitions.sql'
  await db.query(readFileSync('supabase/migrations/'+migration,'utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''))
  const after=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  if(original.length!==after.length||logical(original)!==logical(after)||JSON.stringify(before)!==JSON.stringify(await fingerprints()))throw Error('Existing data changed; refusing commit')
  await db.query('COMMIT')
  console.log(JSON.stringify({committed:true,schemaOnly:true,existingRowsPreserved:true,historyRows:after.length,backup:directory}))
 }else if(!process.argv.includes('--execute')){
  const counts=(await db.query("SELECT event_kind,count(*)::int AS rows FROM process_history GROUP BY event_kind")).rows
  const pairs=(await db.query(`WITH unique_times AS (
   SELECT order_identity,occurred_at FROM process_history GROUP BY order_identity,occurred_at
   HAVING count(*) FILTER(WHERE event_kind='entered')=1 AND count(*) FILTER(WHERE event_kind IN ('completed','returned'))=1
  ) SELECT count(*)::int AS pairs FROM unique_times t JOIN process_history x USING(order_identity,occurred_at)
   JOIN process_history e USING(order_identity,occurred_at)
   WHERE x.event_kind IN ('completed','returned') AND e.event_kind='entered' AND x.next_step_id IS NULL
   AND e.actor_name IS NOT DISTINCT FROM x.actor_name AND e.customer_name IS NOT DISTINCT FROM x.customer_name
   AND e.spk_code=x.spk_code AND e.branch_id IS NOT DISTINCT FROM x.branch_id AND e.assigned_employee_id IS NOT DISTINCT FROM x.assigned_employee_id`)).rows[0].pairs
  console.log(JSON.stringify({counts,mergeablePairs:pairs,remainingRows:counts.reduce((n,row)=>n+row.rows,0)-pairs}));await db.query('ROLLBACK')
 }else{
  await db.query('LOCK TABLE orders,process_history IN SHARE ROW EXCLUSIVE MODE')
  const original=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  const before=await fingerprints()
  mkdirSync(directory,{recursive:true})
  writeFileSync(`${directory}/history-before.json`,JSON.stringify(original),{mode:0o600})
  const functions=(await db.query("SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('capture_process_history','enforce_order_archiving','printex_scoped_snapshot')")).rows
  writeFileSync(`${directory}/before.json`,JSON.stringify({before,functions},null,2),{mode:0o600})
  const sql=readFileSync('supabase/migrations/0027_compact_transitions.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
  await db.query(sql)
  // Only collapse an unambiguous exit/entry pair with identical report metadata.
  await db.query(`CREATE TEMP TABLE compact_pairs ON COMMIT DROP AS
   SELECT x.id AS exit_id,e.id AS entry_id,e.step_id FROM process_history x JOIN process_history e
    ON e.order_identity=x.order_identity AND e.occurred_at=x.occurred_at
    AND e.event_kind='entered' AND x.event_kind IN ('completed','returned')
    AND e.actor_name IS NOT DISTINCT FROM x.actor_name AND e.customer_name IS NOT DISTINCT FROM x.customer_name
    AND e.spk_code=x.spk_code AND e.branch_id IS NOT DISTINCT FROM x.branch_id
    AND e.assigned_employee_id IS NOT DISTINCT FROM x.assigned_employee_id
   WHERE x.next_step_id IS NULL AND
    (SELECT count(*) FROM process_history h WHERE h.order_identity=x.order_identity AND h.occurred_at=x.occurred_at AND h.event_kind='entered')=1 AND
    (SELECT count(*) FROM process_history h WHERE h.order_identity=x.order_identity AND h.occurred_at=x.occurred_at AND h.event_kind IN ('completed','returned'))=1`)
  await db.query('UPDATE process_history h SET next_step_id=p.step_id,next_event_id=p.entry_id FROM compact_pairs p WHERE h.id=p.exit_id')
  const removed=(await db.query('DELETE FROM process_history h USING compact_pairs p WHERE h.id=p.entry_id')).rowCount
  const afterRows=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  if(logical(original)!==logical(afterRows))throw Error('Logical history mismatch; refusing commit')
  if(JSON.stringify(before)!==JSON.stringify(await fingerprints()))throw Error('Business rows changed; refusing commit')
  await db.query("NOTIFY pgrst,'reload schema'")
  await db.query('COMMIT')
  const report={committed:true,ordersPreserved:true,logicalHistoryPreserved:true,before:original.length,after:afterRows.length,removed,backup:directory}
  writeFileSync(`${directory}/after.json`,JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify(report))
 }
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:error.code??'COMPACT_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message.slice(0,300)}));process.exitCode=1}finally{await db.end()}
