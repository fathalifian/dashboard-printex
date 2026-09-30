import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const cache={}
function load(name) {
 if(cache[name])return cache[name]
 const source=ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};cache[name]=exports
 new Function('exports','require',source)(exports,load)
 return exports
}
const {paperOutput}=load('./paper-output')
const order=(id,width,meter=10,type='Sublim')=>({id,production_type:type,paper_width:width,meter})
const event=(id,at)=>({id:id+at,orderId:id,stage:'printing',kind:'completed',occurredAt:at})
test('paper output counts DTF and Sublim widths, keeps unknown separate and deduplicates before filtering dates',()=>{
 const orders=[order('a','1.2',10),order('b','1.6',20),order('c','1.8',30),order('d',null,5),order('e','1.2',99,'DTF')]
 const history=[...orders.map(o=>event(o.id,'2026-09-25T17:00:00Z')),event('a','2026-09-27T01:00:00Z')]
 const output=paperOutput(orders,history,'2026-09-26','2026-09-27')
 assert.deepEqual(output.totals,{'0.6':{meter:99,count:1},'1.2':{meter:10,count:1},'1.6':{meter:20,count:1},'1.8':{meter:30,count:1},unknown:{meter:5,count:1}})
 assert.equal(output.trend.length,2)
 assert.equal(output.trend[1].values['1.2'].meter,0)
 assert.equal(paperOutput(orders,history,'2026-09-27').totals['1.2'].count,0)
 assert.equal(paperOutput(orders,history,'2026-09-25').totals['1.2'].count,0)
 const branch=paperOutput([orders[0]],history,'2026-09-26')
 assert.equal(branch.totals['1.6'].meter,0)
 assert.equal(branch.totals['1.2'].meter,10)
})
test('paper trend includes empty days and inclusive range endpoints',()=>{
 const history=[event('a','2026-09-01T00:00:00Z'),event('b','2026-09-03T00:00:00Z')]
 const output=paperOutput([order('a','1.2',2.5),order('b','1.2',1.5)],history,'2026-09-01','2026-09-03')
 assert.equal(output.totals['1.2'].meter,4)
 assert.equal(output.trend.length,3)
 assert.equal(output.trend[1].values['1.2'].count,0)
})

test('Umbul-umbul, Batik and Jersey contribute to paper output alongside Sublim, with DTF in its own category',()=>{
 const orders=['Sublim','Umbul-umbul','Batik','Jersey','DTF'].map((type,i)=>order(String(i),'1.6',10,type))
 const result=paperOutput(orders,orders.map(o=>event(o.id,'2026-09-26T01:00:00Z')),'2026-09-26')
 assert.deepEqual(result.totals['1.6'],{meter:40,count:4})
})

test('DTF always uses 0.6 and other production cannot use it',()=>{
 const orders=[order('dtf',null,12,'DTF'),order('other','0.6',3)]
 const result=paperOutput(orders,orders.map(o=>event(o.id,'2026-09-26T01:00:00Z')),'2026-09-26')
 assert.deepEqual(result.totals['0.6'],{meter:12,count:1})
 assert.deepEqual(result.totals.unknown,{meter:3,count:1})
})
