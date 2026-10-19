import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={}
new Function('exports','require',ts.transpileModule(readFileSync(new URL('./pending-orders.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,()=>({}))
const {longestPendingOrders,shiftDate}=exports
const now=new Date('2026-09-26T00:30:00+07:00')
const makeOrder=(id,extra={})=>({id,spk_code:id,customer:{name:'Customer',phone:''},production_type:'DTF',meter:100,order_state:'active',board_stage:'printing',due_at:'2026-09-25',order_date:'2026-09-26',created_at:'2026-09-24T01:00:00Z',archive:null,...extra})
const event=(id,orderId,stage,kind,occurredAt)=>({id,orderId,spkCode:orderId,stage,kind,occurredAt,actorName:null,customerName:'Customer'})

test('longest stage uses the latest entry after a return and omits unknown timings',()=>{
 const orders=[makeOrder('return'),makeOrder('unknown'),makeOrder('incoming',{board_stage:'incoming',created_at:'2026-09-25T15:30:00Z'})]
 const history=[event('old','return','printing','entered','2026-09-24T01:00:00Z'),event('new','return','printing','entered','2026-09-25T17:00:00Z')]
 const longest=longestPendingOrders(orders,history,now)
 assert.deepEqual(longest.map(row=>row.order.id),['incoming','return'])
 assert.equal(longest[1].milliseconds,30*60000)
})

test('shiftDate moves whole days across month ends in both directions',()=>{
 assert.equal(shiftDate('2026-09-30',1),'2026-10-01')
 assert.equal(shiftDate('2026-10-01',-6),'2026-09-25')
})
