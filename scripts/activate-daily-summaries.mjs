import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import ts from 'typescript'
import assert from 'node:assert/strict'

const {Client,types}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
types.setTypeParser(1082,value=>value)
const project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const url=new URL(process.env.SUPABASE_DB_URL)
if(!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith(`.${project}`))))throw Error('Database project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
let phase='connect'
const originalQuery=db.query.bind(db)
db.query=(...args)=>{phase=typeof args[0]==='string'?args[0].slice(0,85):'query';return originalQuery(...args)}
const modules=new Map()
function load(name){
 if(modules.has(name))return modules.get(name)
 const exports={};modules.set(name,exports)
 const js=ts.transpileModule(readFileSync(`src/lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',js)(exports,dependency=>load(dependency.replace('./','')))
 return exports
}
const iso=value=>value?new Date(value).toISOString():null
async function fingerprint(){
 const result={}
 for(const table of ['orders','customers','profiles','branches','production_steps','process_history'])result[table]=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM public.${table} t`)).rows[0]
 return result
}
function close(actual,expected,label){assert.ok(Math.abs(actual-expected)<=Math.max(0.01,Math.abs(expected)*1e-10),`${label}: stored=${actual} raw=${expected}`)}
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
 await db.query("SET LOCAL statement_timeout='120s';SET LOCAL lock_timeout='5s'")
 const before=await fingerprint()
 const definition=(await db.query("SELECT pg_get_functiondef('public.printex_online_status()'::regprocedure) AS definition")).rows[0].definition
 if(process.argv.includes('--functions-only')){
  const sql=readFileSync('supabase/report-migrations/0001_daily_summaries.sql','utf8')
  for(const match of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$\$;/g))await db.query(match[0])
  assert.deepEqual(await fingerprint(),before,'Source business data changed')
  await db.query("NOTIFY pgrst,'reload schema'")
  await db.query('COMMIT');console.log(JSON.stringify({committed:true,functionsUpdated:true,sourcePreserved:true}));process.exitCode=0
 }else{
 const staged=process.argv.includes('--staged')&&process.argv.includes('--execute')
 if(!process.argv.includes('--verify-existing')){
  let migration=readFileSync('supabase/report-migrations/0001_daily_summaries.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
  if(staged)migration=migration.replace("'''daily_summaries_enabled'',true,''schema_version'',","'''daily_summaries_enabled'',false,''schema_version'',")
  await db.query(migration)
  if(process.argv.includes('--rebuild'))await db.query('INSERT INTO report_refresh_queue(order_id,branch_id) SELECT id,branch_id FROM orders ON CONFLICT DO NOTHING')
 }
 if(staged){await db.query('COMMIT');console.log(JSON.stringify({stage:'private-schema-installed',dashboardEnabled:false}))}
 let refreshed=0
 for(;;){
  if(staged){await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='3s'")}
  const count=(await db.query('SELECT printex_refresh_report_queue(100) AS count')).rows[0].count
  if(staged)await db.query('COMMIT')
  if(count<0){await new Promise(resolve=>setTimeout(resolve,1000));continue}
  if(!count)break;refreshed+=count;if(refreshed%1000===0)console.log(JSON.stringify({stage:'backfill',refreshed}))
 }
 if(staged){await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL statement_timeout='120s'")}
 console.log(JSON.stringify({stage:'backfill-complete',refreshed}))
 console.log(JSON.stringify({stage:'reading-source-steps'}))
 const steps=new Map((await db.query('SELECT id,code FROM production_steps')).rows.map(row=>[row.id,row.code]))
 const stage={ORDER_IN:'incoming',DESIGN:'design',DESIGN_DONE:'design_done',PRINTING:'printing',PRESS:'press',DONE:'done',ARCHIVE:'archive'}
 const customers=new Map((await db.query('SELECT id,name FROM customers')).rows.map(row=>[row.id,row.name]))
 console.log(JSON.stringify({stage:'reading-source-orders'}))
 const orders=(await db.query('SELECT * FROM orders ORDER BY id')).rows.map(row=>({...row,meter:Number(row.meter),paper_width:row.paper_width==null?null:String(Number(row.paper_width)),customer:{name:customers.get(row.customer_id)??'',phone:''},board_stage:stage[steps.get(row.current_step_id)],created_at:iso(row.created_at),archive:row.archived_at?{archivedAt:iso(row.archived_at),finalizedAt:iso(row.archive_finalized_at)}:null}))
 console.log(JSON.stringify({stage:'reading-source-history'}))
 const historyRows=[];let after=null
 for(;;){const page=(await db.query('SELECT id,order_identity,branch_id,spk_code,customer_name,step_id,event_kind,occurred_at,actor_name,next_step_id,next_event_id FROM process_history WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 5000',[after])).rows;historyRows.push(...page);if(historyRows.length%25000===0)console.log(JSON.stringify({stage:'source-history-page',rows:historyRows.length}));if(page.length<5000)break;after=page.at(-1).id}
 const history=historyRows.flatMap(row=>{
  const event={id:row.id,orderId:row.order_identity,branchId:row.branch_id,spkCode:row.spk_code,customerName:row.customer_name,stage:stage[steps.get(row.step_id)],kind:row.event_kind,occurredAt:iso(row.occurred_at),actorName:row.actor_name}
  return row.next_step_id?[event,{...event,id:row.next_event_id,stage:stage[steps.get(row.next_step_id)],kind:'entered'}]:[event]
 })
 console.log(JSON.stringify({stage:'reading-stored-rows',orders:orders.length,events:history.length}))
 const rows=(await db.query('SELECT * FROM report_daily_summaries WHERE order_count>0')).rows
 const sum=(metric,dimension,start,end,branch)=>rows.filter(r=>r.metric===metric&&(dimension===undefined||r.dimension===dimension)&&r.report_date>=start&&r.report_date<=end&&(!branch||r.branch_id===branch)).reduce((s,r)=>({count:s.count+Number(r.order_count),meter:s.meter+Number(r.meter),ms:s.ms+Number(r.milliseconds)}),{count:0,meter:0,ms:0})
 const metrics=load('process-metrics'),timing=load('process-timing'),productivity=load('productivity')
 const period=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS today")).rows[0].today
 const branches=(await db.query('SELECT id FROM branches')).rows.map(row=>row.id)
 for(const [start,end]of [['2026-09-01','2026-09-30'],['2026-09-01','2026-09-01'],[period,period]]){
  for(const branch of [null,...branches]){
   const scoped=branch?orders.filter(o=>o.branch_id===branch):orders
   const ids=new Set(scoped.map(o=>o.id))
   const events=branch?history.filter(e=>e.branchId===branch):history
   const output=load('daily-output').dailyOutput(scoped,events,start,end)
   for(const dim of ['dtf','sublim']){const stored=sum('output',dim,start,end,branch);close(stored.count,output[dim].count,'output count');close(stored.meter,output[dim].meter,'output meter')}
   const paper=load('paper-output').paperOutput(scoped,events,start,end)
   for(const dim of ['0.6','1.2','1.6','1.8','unknown']){const stored=sum('paper',dim,start,end,branch);close(stored.count,paper.totals[dim].count,'paper count');close(stored.meter,paper.totals[dim].meter,'paper meter')}
   const source=metrics.completionReportEvents(events,scoped)
   for(const [code,s]of Object.entries(stage)){if(s==='archive')continue;close(sum('process',code,start,end,branch).count,metrics.summarizeEvents(source,s,start,end).completed,`process ${code}`)}
   close(sum('intake',undefined,start,end,branch).count,scoped.filter(o=>o.order_date>=start&&o.order_date<=end).length,'intake')
   close(sum('intake_completed',undefined,start,end,branch).count,scoped.filter(o=>o.order_date>=start&&o.order_date<=end&&o.order_state!=='cancelled'&&(o.order_state==='completed'||o.archive?.finalizedAt)).length,'completed intake')
   const flow=load('production-flow').productionFlow(scoped,events,Date.now(),{start,end})
   for(const [code,s]of Object.entries(stage)){if(s==='archive')continue;const expected=flow.find(r=>r.stage===s),stored=sum('flow',code,start,end,branch);close(stored.count,expected.samples,`flow ${code} count`);close(stored.ms,expected.total,`flow ${code} ms`)}
   const archived=scoped.filter(o=>o.archive?.finalizedAt&&metrics.jakartaDate(o.archive.finalizedAt)>=start&&metrics.jakartaDate(o.archive.finalizedAt)<=end)
   close(sum('archive',undefined,start,end,branch).count,archived.length,'archive count');close(sum('archive',undefined,start,end,branch).meter,archived.reduce((s,o)=>s+Math.max(o.meter,0),0),'archive meter')
   const index=new Map();for(const e of events){if(!ids.has(e.orderId))continue;const list=index.get(e.orderId)??[];list.push(e);index.set(e.orderId,list)}
   const at=events.reduce((s,e)=>Math.max(s,Date.parse(e.occurredAt)),0)
   const fact=scoped.map(o=>timing.orderTiming(o,index.get(o.id)??[],at))
   for(const [code,s]of Object.entries(stage)){if(!['design','design_done','printing','press'].includes(s))continue;const selected=fact.filter(t=>t.stages[s].visited&&!t.stages[s].running&&t.stages[s].lastExit&&metrics.jakartaDate(t.stages[s].lastExit)>=start&&metrics.jakartaDate(t.stages[s].lastExit)<=end);const stored=sum('timing',code,start,end,branch);close(stored.count,selected.length,`timing ${code} count`);close(stored.ms,selected.reduce((v,t)=>v+t.stages[s].milliseconds,0),`timing ${code} ms`)}
   const selected=fact.filter(t=>t.finished&&t.totalMilliseconds!==null&&t.completedAt&&metrics.jakartaDate(t.completedAt)>=start&&metrics.jakartaDate(t.completedAt)<=end)
   close(sum('production',undefined,start,end,branch).count,selected.length,'production count');close(sum('production',undefined,start,end,branch).ms,selected.reduce((v,t)=>v+t.totalMilliseconds,0),'production ms')
   const productive=productivity.productivityRows(scoped,events,start,end)
   for(const dim of ['dtf','sublim','press']){const stored=rows.filter(r=>r.metric==='productivity'&&r.dimension.startsWith(dim+':')&&r.report_date>=start&&r.report_date<=end&&(!branch||r.branch_id===branch));const expected=productivity.summarizeProductivity(productive[dim]);close(stored.reduce((s,r)=>s+Number(r.order_count),0),expected.orderCount,`productivity ${dim} count`);close(stored.reduce((s,r)=>s+Number(r.meter),0),expected.totalMeter,`productivity ${dim} meter`);close(stored.reduce((s,r)=>s+Number(r.milliseconds),0),expected.totalMilliseconds,`productivity ${dim} ms`)}
  }
  console.log(JSON.stringify({stage:'parity-passed',start,end,branches:branches.length}))
 }
 assert.deepEqual(await fingerprint(),before,'Source business data changed')
 const owner=(await db.query("SELECT id FROM profiles WHERE role='central_owner' AND is_active LIMIT 1")).rows[0]
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.id]);await db.query('SET LOCAL ROLE authenticated')
 const began=performance.now();const report=(await db.query("SELECT printex_daily_report('2026-09-01','2026-09-01') AS data")).rows[0].data
 console.log(JSON.stringify({stage:'saved-day-read',rows:report.rows.length,bytes:JSON.stringify(report).length,milliseconds:Math.round(performance.now()-began),pending:report.pending}))
 await db.query('RESET ROLE')
 const scheduler=(await db.query("SELECT to_regnamespace('cron') IS NOT NULL AS available")).rows[0].available
 if(process.argv.includes('--execute')){
  if(!scheduler)throw Error('Automatic report scheduler unavailable; refusing activation until configured')
  const directory=`build/backups/daily-summaries-${new Date().toISOString().replace(/[:.]/g,'-')}`;mkdirSync(directory,{recursive:true})
  writeFileSync(`${directory}/activation.json`,JSON.stringify({before,statusDefinition:definition,refreshed,summaryRows:rows.length,sourcePreserved:true},null,2),{mode:0o600})
  const activeDefinition=(await db.query("SELECT pg_get_functiondef('public.printex_online_status()'::regprocedure) AS definition")).rows[0].definition
  await db.query(activeDefinition.replace(/('daily_summaries_enabled',\s*)false/,'$1true'))
  await db.query("NOTIFY pgrst,'reload schema'")
  await db.query('COMMIT');console.log(JSON.stringify({committed:true,sourcePreserved:true,refreshed,summaryRows:rows.length,scheduler,backup:directory}))
 }else{await db.query('ROLLBACK');console.log(JSON.stringify({committed:false,previewPassed:true,refreshed,summaryRows:rows.length,scheduler}))}
}
}catch(error){const failedPhase=phase;await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({phase:failedPhase,error:error.message}));process.exitCode=1}finally{await db.end()}
