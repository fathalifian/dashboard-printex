import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
try{
 await db.connect()
 const available=(await db.query("SELECT name,installed_version FROM pg_available_extensions WHERE name='pg_cron'")).rows
 const settings=(await db.query("SELECT setting FROM pg_settings WHERE name='shared_preload_libraries'")).rows[0]
 console.log(JSON.stringify({available,preloaded:settings.setting.includes('pg_cron')}))
 if(process.argv.includes('--activity'))console.log(JSON.stringify({activity:(await db.query("SELECT state,wait_event_type,wait_event,extract(epoch FROM clock_timestamp()-query_start)::int AS seconds,left(query,100) AS query FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND usename=current_user AND state<>'idle'")).rows}))
 if(process.argv.includes('--status'))console.log(JSON.stringify({reportStatus:(await db.query("SELECT position('daily_summaries_enabled' IN pg_get_functiondef('public.printex_online_status()'::regprocedure))>0 AS installed,position('daily_summaries_enabled'',true' IN pg_get_functiondef('public.printex_online_status()'::regprocedure))>0 AS enabled,(SELECT count(*) FROM report_refresh_queue) AS pending,(SELECT count(*) FROM report_daily_summaries WHERE order_count>0) AS summary_rows,(SELECT count(*) FROM report_contributions) AS contributions")).rows[0]}))
 if(process.argv.includes('--reads')){
  console.log(JSON.stringify({dates:(await db.query("SELECT min(report_date)::text AS first,max(report_date)::text AS last,count(*) AS rows FROM report_daily_summaries WHERE order_count>0")).rows[0]}))
  const day=(await db.query("SELECT report_date::text AS day FROM report_daily_summaries WHERE order_count>0 AND report_date<(now() AT TIME ZONE 'Asia/Jakarta')::date GROUP BY report_date ORDER BY count(*) DESC LIMIT 1")).rows[0]?.day??'2026-09-01'
  const owner=(await db.query("SELECT id FROM profiles WHERE role='central_owner' AND is_active LIMIT 1")).rows[0]
  await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.id]);await db.query('SET LOCAL ROLE authenticated')
  console.log(JSON.stringify({access:(await db.query("SELECT public.printex_staff() AS active,(SELECT count(*) FROM public.printex_read_branches()) AS branches")).rows[0]}))
  const before=performance.now(),data=(await db.query('SELECT printex_daily_report($1::date,$1::date) AS data',[day])).rows[0].data
  console.log(JSON.stringify({savedRead:{day,rows:data.rows.length,bytes:JSON.stringify(data).length,milliseconds:Math.round(performance.now()-before),pending:data.pending}}))
  await db.query('ROLLBACK')
 }
 if(process.argv.includes('--isolation')){
  const users=(await db.query("SELECT id,branch_id FROM profiles WHERE role IN ('owner','admin','operator') AND is_active AND branch_id IS NOT NULL")).rows
  for(const user of users){
   const other=(await db.query('SELECT id FROM branches WHERE id<>$1 AND is_active LIMIT 1',[user.branch_id])).rows[0]?.id
   await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);await db.query('SET LOCAL ROLE authenticated')
   const own=(await db.query("SELECT printex_daily_report('2026-09-01','2026-09-30') AS data")).rows[0].data
   if(own.rows.some(row=>row.branchId!==user.branch_id))throw Error('Cross-branch summary read')
   if(other){const forged=(await db.query("SELECT printex_daily_report('2026-09-01','2026-09-30',$1) AS data",[other])).rows[0].data;if(forged.rows.length)throw Error('Forged branch read');const detail=(await db.query("SELECT printex_report_details('2026-09-01','2026-09-30','archive','',$1) AS data",[other])).rows[0].data;if(Number(detail.total)!==0)throw Error('Forged detail read')}
   await db.query('ROLLBACK')
  }
  console.log(JSON.stringify({branchIsolationPassed:true,accounts:users.length}))
 }
 if(process.argv.includes('--enable')){
  if(!available.length||!settings.setting.includes('pg_cron'))throw Error('pg_cron is unavailable')
  await db.query('CREATE EXTENSION IF NOT EXISTS pg_cron')
  console.log(JSON.stringify({schedulerEnabled:true}))
 }
 if((await db.query("SELECT to_regnamespace('cron') IS NOT NULL AS exists")).rows[0].exists){
  console.log(JSON.stringify({jobs:(await db.query("SELECT jobid,jobname,schedule,command,active FROM cron.job WHERE jobname='printex-daily-report-refresh'")).rows}))
 }
}finally{await db.end()}
