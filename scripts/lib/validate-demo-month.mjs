import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const modules=new Map()
function load(name){
 if(modules.has(name))return modules.get(name)
 const source=ts.transpileModule(readFileSync(new URL(`../../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};modules.set(name,exports)
 new Function('exports','require',source)(exports,dependency=>load(dependency.replace('./','')))
 return exports
}
export async function validateDemoMonth(db){
 const date=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date-29)::text AS start,(now() AT TIME ZONE 'Asia/Jakarta')::date::text AS finish")).rows[0]
 const stats=(await db.query(`SELECT count(*)::int AS orders,count(DISTINCT order_date)::int AS days,
 count(*) FILTER(WHERE source IS DISTINCT FROM 'simulation' OR spk_code !~ '^PTXID[0-9A-F]{8}$')::int AS old_orders,
 count(*) FILTER(WHERE completed_at IS NULL AND due_at<(now() AT TIME ZONE 'Asia/Jakarta')::date)::int AS overdue,
 count(*) FILTER(WHERE (completed_at AT TIME ZONE 'Asia/Jakarta')::date>due_at)::int AS finished_late,
 count(*) FILTER(WHERE (completed_at AT TIME ZONE 'Asia/Jakarta')::date<due_at)::int AS finished_early,
 count(*) FILTER(WHERE archive_finalized_at IS NOT NULL AND delivery_method='pickup')::int AS pickup,
 count(*) FILTER(WHERE archive_finalized_at IS NOT NULL AND delivery_method='delivery')::int AS delivery,
 count(DISTINCT production_type)::int AS types FROM orders`)).rows[0]
 assert.equal(stats.days,30);assert.equal(stats.old_orders,0);assert.equal(stats.types,5)
 for(const key of ['overdue','finished_late','finished_early','pickup','delivery'])assert.ok(stats[key]>0,key)
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM process_history h JOIN orders o ON o.id=h.order_id
 WHERE h.branch_id<>o.branch_id OR h.occurred_at<o.created_at OR h.occurred_at>now()`)).rows[0].n,0)
 assert.ok((await db.query("SELECT count(*)::int AS n FROM process_history WHERE event_kind='returned'")).rows[0].n>0)
 const steps=(await db.query('SELECT id,code FROM production_steps')).rows
 const codes={ORDER_IN:'incoming',DESIGN:'design',DESIGN_DONE:'design_done',PRINTING:'printing',PRESS:'press',DONE:'done',ARCHIVE:'archive'}
 const step=new Map(steps.map(s=>[s.id,codes[s.code]]))
 const iso=v=>v instanceof Date?v.toISOString():v
 const calendar=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:v
 const orders=(await db.query('SELECT * FROM orders')).rows.map(o=>({...o,meter:Number(o.meter),paper_width:o.paper_width==null?null:String(Number(o.paper_width)),order_date:calendar(o.order_date),due_at:calendar(o.due_at),created_at:iso(o.created_at),board_stage:step.get(o.current_step_id),archive:o.archived_at?{archivedAt:iso(o.archived_at),finalizedAt:iso(o.archive_finalized_at),deliveryMethod:o.delivery_method}:null}))
 const history=(await db.query('SELECT * FROM process_history')).rows.map(h=>({id:h.id,orderId:h.order_identity,branchId:h.branch_id,spkCode:h.spk_code,stage:step.get(h.step_id),kind:h.event_kind,occurredAt:iso(h.occurred_at),actorName:h.actor_name}))
 const branches=(await db.query('SELECT id,name FROM branches WHERE is_active ORDER BY name')).rows
 const {centralDashboardSummary}=load('central-dashboard'),{paperOutput}=load('paper-output'),{productivityRows,summarizeProductivity}=load('productivity')
 const dashboard=centralDashboardSummary(orders,history,branches,date.start,date.finish,date.finish)
 assert.equal(dashboard.overdue.length,stats.overdue)
 const expected=Number((await db.query(`SELECT coalesce(sum(meter),0) AS meter FROM orders o WHERE EXISTS(
 SELECT 1 FROM process_history h JOIN production_steps s ON s.id=h.step_id WHERE h.order_id=o.id AND s.code='PRINTING' AND h.event_kind='completed')`)).rows[0].meter)
 const near=(a,b)=>assert.ok(Math.abs(a-b)<0.0001,`${a} != ${b}`)
 const output=row=>row.dtf.meter+row.sublim.meter
 near(output(dashboard.output),expected)
 near(dashboard.rows.reduce((s,r)=>s+output(r.output),0),expected)
 near(dashboard.trend.reduce((s,r)=>s+output(r),0),expected)
 const papers=paperOutput(orders,history,date.start,date.finish)
 near(Object.values(papers.totals).reduce((s,r)=>s+r.meter,0),expected)
 for(const row of dashboard.rows){
  const separate=centralDashboardSummary(orders.filter(o=>o.branch_id===row.id),history,[row],date.start,date.finish,date.finish)
  near(output(separate.output),output(row.output))
  const expectedBranch=(await db.query(`SELECT count(*) FILTER(WHERE completed_at IS NOT NULL)::int AS completed,
    count(*) FILTER(WHERE completed_at IS NULL)::int AS pending FROM orders WHERE branch_id=$1`,[row.id])).rows[0]
  assert.equal(row.completed,expectedBranch.completed);assert.equal(row.pending,expectedBranch.pending)
  assert.ok(row.completed+row.pending>=900 && row.completed+row.pending<=1500,'Monthly branch volume')
 }
 const salatiga=dashboard.rows.find(row=>row.name.toLowerCase()==='salatiga')
 assert.ok(salatiga,'Salatiga present')
 assert.equal(salatiga.completed+salatiga.pending,1500)
 assert.ok(dashboard.rows.filter(row=>row!==salatiga).every(row=>row.completed+row.pending<1500),'Salatiga has most orders')
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid IN ('orders'::regclass,'customers'::regclass,'process_history'::regclass) AND tgenabled='D'`)).rows[0].n,0)
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM (SELECT 'orders' AS name,id FROM orders UNION ALL SELECT 'customers',id FROM customers UNION ALL SELECT 'process_history',id FROM process_history) d
 WHERE NOT EXISTS(SELECT 1 FROM printex_row_changes c WHERE c.table_name=d.name AND c.row_id=d.id AND NOT c.deleted)`)).rows[0].n,0)
 const productivity=productivityRows(orders,history,date.start,date.finish)
 const intervals=(await db.query(`WITH visits AS (
 SELECT h.order_id,s.code,h.occurred_at,lead(h.occurred_at) OVER(PARTITION BY order_id ORDER BY occurred_at) AS next_at
 FROM process_history h JOIN production_steps s ON s.id=h.step_id WHERE event_kind='entered'
 ), durations AS (
 SELECT order_id,code,sum(extract(epoch FROM(next_at-occurred_at))*1000) AS ms
 FROM visits WHERE code IN ('PRINTING','PRESS') GROUP BY order_id,code HAVING bool_and(next_at IS NOT NULL)
 ) SELECT CASE WHEN code='PRESS' THEN 'press' WHEN o.production_type='DTF' THEN 'dtf' ELSE 'sublim' END AS process,
 sum(ms) AS ms,sum(meter) AS meter,count(*)::int AS orders FROM durations d JOIN orders o ON o.id=d.order_id GROUP BY 1`)).rows
 for(const row of intervals){const actual=summarizeProductivity(productivity[row.process]);near(actual.totalMilliseconds,Number(row.ms));near(actual.totalMeter,Number(row.meter));assert.equal(actual.orderCount,row.orders)}
 const stageCounts=(await db.query(`SELECT b.name AS branch,s.code AS stage,count(*)::int AS orders FROM orders o JOIN branches b ON b.id=o.branch_id JOIN production_steps s ON s.id=o.current_step_id WHERE archive_finalized_at IS NULL GROUP BY b.name,s.code ORDER BY 1,2`)).rows
 const examples=(await db.query('SELECT spk_code,notes FROM orders ORDER BY order_date DESC,spk_code LIMIT 3')).rows
 assert.ok(orders.every(o=>o.notes.includes('Judul file: ') && o.notes.includes('Jenis kain: ')))
 const report={period:date,...stats,history:history.length,outputMeter:Math.round(expected*10)/10,branches:dashboard.rows.map(r=>({name:r.name,orders:r.completed+r.pending,pending:r.pending,overdue:r.overdue,completed:r.completed,outputMeter:Math.round(output(r.output)*10)/10})),stageCounts,examples,verified:['monthly branch volume','document/filename format','timeline','branch isolation in summaries','print/paper totals','daily trend','productivity duration vs SQL','revisions','early/late/pending','pickup/delivery']}
 return report
}
