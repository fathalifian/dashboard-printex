import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import ts from 'typescript'

const { Client, types } = createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
types.setTypeParser(1082,value=>value)
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,query_timeout:60000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const modules=new Map()
function load(name){
 if(modules.has(name))return modules.get(name)
 const exports={};modules.set(name,exports)
 const source=ts.transpileModule(readFileSync(`src/lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',source)(exports,dependency=>load(dependency.replace('./','')))
 return exports
}
const iso=value=>value ? new Date(value).toISOString() : value
function domain(data){
 const stage={ORDER_IN:'incoming',DESIGN:'design',DESIGN_DONE:'design_done',PRINTING:'printing',PRESS:'press',DONE:'done',ARCHIVE:'archive'}
 const steps=new Map(data.production_steps.map(row=>[row.id,stage[row.code]]))
 const customers=new Map(data.customers.map(row=>[row.id,row]))
 const orders=data.orders.map(row=>({...row,customer:{name:customers.get(row.customer_id)?.name??'',phone:''},meter:Number(row.meter),paper_width:row.paper_width==null?null:String(Number(row.paper_width)),board_stage:steps.get(row.current_step_id),created_at:iso(row.created_at),archive:row.archived_at?{archivedAt:iso(row.archived_at),finalizedAt:iso(row.archive_finalized_at),deliveryMethod:row.delivery_method}:null}))
 const history=data.process_history.map(row=>({id:row.id,orderId:row.order_identity,branchId:row.branch_id,spkCode:row.spk_code,customerName:row.customer_name,stage:steps.get(row.step_id),kind:row.event_kind,occurredAt:iso(row.occurred_at),actorName:row.actor_name}))
 orders.sort((a,b)=>a.id.localeCompare(b.id));history.sort((a,b)=>a.id.localeCompare(b.id))
 return {orders,history}
}
function metrics(data,branches,start,end){
 const {orders,history}=domain(data)
 const central=load('central-dashboard').centralDashboardSummary(orders,history,branches,start,end,end)
 const process=load('process-metrics'),source=process.processReportEvents(history,orders)
 const productivity=load('productivity')
 const rows=productivity.productivityRows(orders,history,start,end)
 return {
  output:central.output,rows:central.rows,pending:central.pending,overdue:central.overdue.map(o=>o.id),trend:central.trend,activity:central.activity,
  paper:load('paper-output').paperOutput(orders,history,start,end),
  process:Object.fromEntries(process.PROCESS_STAGES.map(stage=>[stage,process.summarizeEvents(source,stage,start,end)])),
  productivity:Object.fromEntries(Object.entries(rows).map(([key,value])=>[key,productivity.summarizeProductivity(value)])),
 }
}
function compare(actual,expected,path='metrics'){
 if(typeof actual==='number'&&typeof expected==='number'){
  if(Math.abs(actual-expected)>Math.max(1e-6,Math.abs(expected)*1e-10))throw Error(`Numeric mismatch at ${path}`)
  return
 }
 if(actual===null||expected===null||typeof actual!=='object'||typeof expected!=='object'){
  if(actual!==expected)throw Error(`Value mismatch at ${path}`)
  return
 }
 if(Array.isArray(actual)!==Array.isArray(expected))throw Error(`Shape mismatch at ${path}`)
 const keys=Object.keys(actual).sort(),other=Object.keys(expected).sort()
 assert.deepEqual(keys,other,`Keys differ at ${path}`)
 for(const key of keys)compare(actual[key],expected[key],`${path}.${key}`)
}
async function pagedSnapshot(start,end){
 const timings=[]
 const began=performance.now()
 const scoped=(await db.query('SELECT printex_scoped_snapshot($1,$2) AS data',[start,end])).rows[0].data
 timings.push(Math.round(performance.now()-began))
 let page=scoped
 while(page.history_more){
  const began=performance.now(),after=page.history_cursor
  page=(await db.query('SELECT printex_scoped_snapshot($1,$2,NULL,NULL,NULL,$3,true,$4) AS data',[start,end,after,scoped.identities])).rows[0].data
  assert.notEqual(page.history_cursor,after)
  scoped.process_history.push(...page.process_history)
  timings.push(Math.round(performance.now()-began))
 }
 assert.equal(new Set(scoped.process_history.map(row=>row.id)).size,scoped.process_history.length)
 console.log(JSON.stringify({stage:'pages',pages:timings.length,maxMilliseconds:Math.max(...timings),timings}))
 return scoped
}
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 await db.query("SET LOCAL statement_timeout='45s'")
 const owner=(await db.query("SELECT id FROM profiles WHERE role='central_owner' AND is_active LIMIT 1")).rows[0]
 if(!owner)throw Error('No active central owner')
 const period=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS today,((now() AT TIME ZONE 'Asia/Jakarta')::date-29)::text AS start")).rows[0]
 const branches=(await db.query('SELECT id,name FROM branches WHERE is_active ORDER BY name')).rows
 const policies=(await db.query("SELECT tablename,qual FROM pg_policies WHERE schemaname='public' AND policyname IN ('branch_read','branches_read')")).rows
 const accessCacheActive=policies.length===4&&policies.every(policy=>policy.qual.includes('printex_read_branches'))
 const archiveReadsSkipped=(await db.query("SELECT position('skip_archive_process' IN pg_get_functiondef(oid))>0 AS active FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='printex_scoped_snapshot'")).rows[0]?.active??false
 console.log(JSON.stringify({stage:'configuration',accessCacheActive,archiveReadsSkipped}))
 if(process.argv.includes('--metadata-only')) {
  console.log(JSON.stringify({stage:'archive-read-reduction',...(await db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE s.code='ARCHIVE')::int AS excluded FROM process_history h JOIN production_steps s ON s.id=h.step_id")).rows[0]}))
  const definitions=(await db.query("SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('capture_process_history','enforce_order_archiving')")).rows
  console.log(JSON.stringify({stage:'workflow',compactTransitionsActive:definitions.some(row=>row.proname==='capture_process_history'&&row.definition.includes('next_event_id')),directArchiveActive:definitions.some(row=>row.proname==='enforce_order_archiving'&&row.definition.includes("NEW.delivery_method = 'received' THEN NEW.archive_finalized_at := NEW.archived_at"))}))
 }
 if (process.argv.includes('--activity-only')) console.log(JSON.stringify({stage:'activity',queries:(await db.query("SELECT extract(epoch FROM clock_timestamp()-query_start)::int AS seconds,wait_event_type,wait_event FROM pg_stat_activity WHERE state='active' AND pid<>pg_backend_pid() AND usename=current_user")).rows}))
 if (process.argv.includes('--plan-only')) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.id])
  await db.query('SET LOCAL ROLE authenticated')
  const plan=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
   WITH selected_identity AS MATERIALIZED (
    SELECT o.id::text AS identity FROM orders o WHERE o.archive_finalized_at IS NULL
     OR o.order_date BETWEEN $1::date AND $2::date OR o.archive_finalized_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')
       AND o.archive_finalized_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')
    UNION SELECT h.order_identity FROM process_history h
     WHERE h.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND h.occurred_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')
   ) SELECT count(*) FROM process_history h JOIN selected_identity i ON i.identity=h.order_identity`,[period.start,period.today])).rows[0]['QUERY PLAN']
  console.log(JSON.stringify(plan))
 } else if (process.argv.includes('--counts-only')) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.id])
  await db.query('SET LOCAL ROLE authenticated')
  const began=performance.now()
  await db.query("SET LOCAL statement_timeout='8s'")
  const result=await pagedSnapshot(period.start,period.today)
  console.log(JSON.stringify({stage:'monthly-server',orders:result.orders.length,history:result.process_history.length,bytes:Buffer.byteLength(JSON.stringify(result)),milliseconds:Math.round(performance.now()-began)}))
 } else if (!process.argv.includes('--metadata-only')) {
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.id])
 await db.query('SET LOCAL ROLE authenticated')
 const baseline={}
 for(const table of ['orders','customers','production_steps','process_history']){
  const began=performance.now()
  baseline[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows
  console.log(JSON.stringify({stage:'baseline',table,rows:baseline[table].length,milliseconds:Math.round(performance.now()-began)}))
 }
 const report={checkedAt:new Date().toISOString(),accessCacheActive,period,baseline:{orders:baseline.orders.length,history:baseline.process_history.length},measurements:[]}
 const periods=process.argv.includes('--today-only')?[['today',period.today]]:[['today',period.today],['month',period.start]]
 for(const [label,start] of periods){
  const began=performance.now()
  const scoped=await pagedSnapshot(start,period.today)
  const milliseconds=Math.round(performance.now()-began)
  console.log(JSON.stringify({stage:'scoped',label,orders:scoped.orders.length,history:scoped.process_history.length,milliseconds}))
  compare(metrics(scoped,branches,start,period.today),metrics(baseline,branches,start,period.today))
  report.measurements.push({label,start,end:period.today,milliseconds,orders:scoped.orders.length,history:scoped.process_history.length,bytes:Buffer.byteLength(JSON.stringify(scoped)),historyReductionPercent:Math.round((1-scoped.process_history.length/baseline.process_history.length)*1000)/10,metricsMatch:true})
 }
 await db.query('COMMIT')
 writeFileSync('build/scoped-loading-verification.json',JSON.stringify(report,null,2),{mode:0o600})
 console.log(JSON.stringify(report,null,2))
 }
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:error.code??'VERIFICATION_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message.slice(0,300)}));process.exitCode=1}finally{await db.end()}
