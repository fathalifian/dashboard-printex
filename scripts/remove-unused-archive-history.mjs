import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const url=new URL(process.env.SUPABASE_DB_URL),project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if(!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith(`.${project}`))))throw Error('Database project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const archive="step_id IN (SELECT id FROM public.production_steps WHERE code='ARCHIVE')"
async function fingerprint(table,where='true'){
 return (await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM public.${table} t WHERE ${where}`)).rows[0]
}
async function preserved(){
 const result={};for(const table of ['orders','customers','profiles','branches','production_steps'])result[table]=await fingerprint(table)
 result.productionHistory=await fingerprint('process_history',`NOT (${archive})`)
 return result
}
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
 await db.query("SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'")
 const active=(await db.query("SELECT position('skip_archive_process' IN pg_get_functiondef(oid))>0 AS active FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='printex_scoped_snapshot'")).rows[0]?.active
 if(!active)throw Error('Dashboard archive read filter is not active')
 if(process.argv.includes('--execute'))await db.query('LOCK TABLE orders,customers,profiles,branches,production_steps,process_history IN SHARE ROW EXCLUSIVE MODE')
 const rows=(await db.query(`SELECT * FROM public.process_history WHERE ${archive} ORDER BY id`)).rows
 if(rows.some(row=>row.event_kind!=='entered'||row.next_step_id))throw Error('Archive contains completion/revision/transition records; refusing deletion')
 const total=(await db.query('SELECT count(*)::int AS count FROM process_history')).rows[0].count
 if(!process.argv.includes('--execute')){
  console.log(JSON.stringify({readFilterActive:active,total,candidates:rows.length,kinds:[...new Set(rows.map(row=>row.event_kind))],remaining:total-rows.length}));await db.query('ROLLBACK')
 }else{
  const before=await preserved()
  const directory=`build/backups/unused-archive-history-${new Date().toISOString().replace(/[:.]/g,'-')}`
  mkdirSync(directory,{recursive:true})
  writeFileSync(`${directory}/deleted-rows.json`,JSON.stringify(rows),{mode:0o600})
  writeFileSync(`${directory}/before.json`,JSON.stringify({total,before},null,2),{mode:0o600})
  const deleted=(await db.query(`DELETE FROM public.process_history WHERE ${archive}`)).rowCount
  if(deleted!==rows.length||JSON.stringify(before)!==JSON.stringify(await preserved()))throw Error('Unexpected changes; refusing commit')
  const remaining=(await db.query('SELECT count(*)::int AS count FROM process_history')).rows[0].count
  if(remaining!==total-deleted)throw Error('Unexpected remaining count; refusing commit')
  await db.query('COMMIT')
  const report={committed:true,before:total,deleted,remaining,ordersAndProductionHistoryPreserved:true,backup:directory}
  writeFileSync(`${directory}/after.json`,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))
 }
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:error.code??'ARCHIVE_CLEANUP_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message.slice(0,300)}));process.exitCode=1}finally{await db.end()}
