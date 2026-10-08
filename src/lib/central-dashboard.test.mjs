import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const cache={}
function load(name){
 if(cache[name])return cache[name]
 const exports={};cache[name]=exports
 const src=ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',src)(exports,load)
 return exports
}
const {centralDashboard}=load('./central-dashboard')
const branches=[{id:'a',name:'Salatiga'},{id:'b',name:'Semarang'}]
const now=new Date('2026-09-26T00:30:00+07:00')
const makeOrder=(id,branch_id,extra={})=>({id,branch_id,spk_code:id,customer:{name:'Customer',phone:''},production_type:'DTF',meter:100,order_state:'active',board_stage:'printing',due_at:'2026-09-25',order_date:'2026-09-26',created_at:'2026-09-24T01:00:00Z',archive:null,...extra})
const event=(id,orderId,stage,kind,occurredAt,extra={})=>({id,orderId,spkCode:orderId,stage,kind,occurredAt,actorName:'Operator',customerName:'Customer',...extra})

test('large multi-day summaries index orders once rather than once per chart day',()=>{
 let idReads=0
 const orders=Array.from({length:5000},(_,i)=>{
  const id='bulk-'+i
  return {...makeOrder(id,i%2?'a':'b'),get id(){idReads++;return id}}
 })
 const history=orders.map((order,i)=>event(String(i),order.id,'printing','completed','2026-09-25T17:10:00Z'))
 idReads=0
 const result=centralDashboard(orders,history,branches,'2026-07-01','2026-10-01',now)
 assert.equal(result.output.dtf.count,5000)
 assert.equal(result.output.dtf.meter,500000)
 assert.equal(result.trend.reduce((sum,day)=>sum+day.dtf.count,0),5000)
 assert.equal(result.rows.reduce((sum,branch)=>sum+branch.output.dtf.count,0),5000)
 assert.ok(idReads < orders.length*10,`Indexed orders ${idReads} times`)
})

test('central output matches the sum of branches and print completions count once',()=>{
 const orders=[makeOrder('a1','a'),makeOrder('b1','b',{production_type:'Batik',meter:50}),makeOrder('x','outside',{meter:999})]
 const history=[
 event('1','a1','printing','completed','2026-09-25T17:10:00Z'),
 event('2','a1','printing','completed','2026-09-25T17:20:00Z'),
 event('3','b1','printing','completed','2026-09-25T17:10:00Z'),
 event('4','x','printing','completed','2026-09-25T17:10:00Z')]
 const r=centralDashboard(orders,history,branches,'2026-09-26','2026-09-26',now)
 assert.equal(r.output.dtf.meter,100)
 assert.equal(r.output.sublim.meter,50)
 for(const kind of ['dtf','sublim'])assert.equal(r.output[kind].meter,r.rows.reduce((n,row)=>n+row.output[kind].meter,0))
 assert.equal(r.trend.length,1)
 assert.equal(r.trend.at(-1).dtf.meter,100)
})

test('pending and overdue follow intake period while retaining current status',()=>{
 const orders=[makeOrder('late','a'),makeOrder('today','b',{due_at:'2026-09-26'}),makeOrder('done','a',{order_state:'completed',board_stage:'done'}),makeOrder('archive','a',{order_state:'completed',board_stage:'archive',archive:{finalizedAt:'2026-09-25T00:00:00Z'}})]
 const empty=centralDashboard(orders,[],branches,'2026-01-01','2026-01-01',now)
 assert.equal(empty.pending,0)
 assert.equal(empty.overdue.length,0)
 const r=centralDashboard(orders,[],branches,'2026-09-26','2026-09-26',now)
 assert.equal(r.pending,2)
 assert.deepEqual(r.overdue.map(o=>o.id),['late'])
 assert.deepEqual(r.dueToday.map(o=>o.id),['today'])
 assert.equal(r.output.dtf.meter,0)
 assert.equal(r.rows[0].name,'Salatiga')
})

test('longest stage uses the latest entry after a return and omits unknown timings',()=>{
 const orders=[makeOrder('return','a'),makeOrder('unknown','a'),makeOrder('incoming','b',{board_stage:'incoming',created_at:'2026-09-25T15:30:00Z'})]
 const history=[event('old','return','printing','entered','2026-09-24T01:00:00Z'),event('new','return','printing','entered','2026-09-25T17:00:00Z')]
 const r=centralDashboard(orders,history,branches,'2026-09-26','2026-09-26',now)
 assert.deepEqual(r.longest.map(row=>row.order.id),['incoming','return'])
 assert.equal(r.longest[1].milliseconds,30*60000)
})

test('activity includes archive finalization and retained history with branch attribution',()=>{
 const orders=[makeOrder('archived','a',{order_state:'completed',archive:{finalizedAt:'2026-09-25T17:20:00Z'}})]
 const history=[event('deleted','removed','printing','completed','2026-09-25T17:10:00Z',{branchId:'b'}),event('other','removed2','incoming','entered','2026-09-25T17:15:00Z',{branchId:'outside'})]
 const r=centralDashboard(orders,history,branches,'2026-09-26','2026-09-26',now)
 assert.deepEqual(r.activity.map(a=>a.label),['Diarsipkan','Selesai print'])
 assert.equal(r.activity[1].branch,'Semarang')
 assert.equal(r.activity[1].orderId,undefined)
})

test('trend uses inclusive selected dates and sums exactly to output cards',()=>{
 const orders=[makeOrder('first','a'),makeOrder('last','b',{production_type:'Batik',meter:50}),makeOrder('outside','a')]
 const history=[event('1','first','printing','completed','2026-09-24T17:00:00Z'),event('2','last','printing','completed','2026-09-26T16:59:59Z'),event('3','outside','printing','completed','2026-09-26T17:00:00Z')]
 const range=centralDashboard(orders,history,branches,'2026-09-25','2026-09-26',now)
 assert.deepEqual(range.trend.map(day=>day.day),['2026-09-25','2026-09-26'])
 for(const kind of ['dtf','sublim']) assert.equal(range.trend.reduce((sum,day)=>sum+day[kind].meter,0),range.output[kind].meter)
 const day=centralDashboard(orders,history,branches,'2026-09-26','2026-09-26',now)
 assert.equal(day.trend.length,1)
 assert.equal(day.output.dtf.meter,0)
 assert.equal(day.output.sublim.meter,50)
 assert.ok(day.activity.every(item=>item.spk==='last'))
 const month=centralDashboard([],[],branches,'2026-09-01','2026-09-30',now)
 assert.equal(month.trend.length,30)
})


test('completed branch counts follow intake period, include archives once and exclude cancelled orders',()=>{
 const orders=[
  makeOrder('done','a',{order_state:'completed'}),
  makeOrder('archived','a',{order_state:'completed',archive:{finalizedAt:'2026-09-26T00:00:00Z'}}),
  makeOrder('old','a',{order_state:'completed',order_date:'2026-09-01'}),
  makeOrder('cancelled','a',{order_state:'cancelled'}),
  makeOrder('active','a'),
  makeOrder('other','b',{order_state:'completed'}),
  makeOrder('outside','outside',{order_state:'completed'}),
 ]
 const result=centralDashboard(orders,[],branches,'2026-09-26','2026-09-26',now)
 assert.equal(result.rows.find(row=>row.id==='a').completed,2)
 assert.equal(result.rows.find(row=>row.id==='b').completed,1)
 const selected=centralDashboard(orders,[],[branches[0]],'2026-09-26','2026-09-26',now)
 assert.equal(selected.rows.length,1)
 assert.equal(selected.rows[0].completed,2)
})
