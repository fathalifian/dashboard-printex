import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const codes={incoming:'ORDER_IN',design:'DESIGN',design_done:'DESIGN_DONE',printing:'PRINTING',press:'PRESS',done:'DONE'}
function setup(){
 const status={state:'ready',profile:{id:'owner',role:'central_owner'},branchId:null,branches:[{id:'a'},{id:'b'}],reportSummariesEnabled:true}
 const calls=[];const effects=[];let reply
 const exports={}
 const js=ts.transpileModule(readFileSync(new URL('./report-summaries.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 runInNewContext(js,{exports,require(name){
  if(name==='react')return{useEffect(fn){effects.push(fn)},useSyncExternalStore(subscribe,get){subscribe(()=>{});return get()}}
  if(name==='./report-client')return{requestReport(name,args){calls.push({name,args});return new Promise(resolve=>{reply=resolve})}}
  if(name==='./production-board')return{useOnlineConnection:()=>status,BOARD_STAGE_META:Object.fromEntries(Object.entries(codes).map(([key,code])=>[key,{code}]))}
  if(name==='./paper-output')return{PAPER_WIDTHS:['0.6','1.2','1.6','1.8']}
  return require(name)
 },AbortSignal,Date,JSON,window:{setInterval(){return 1},clearInterval(){}},document:{visibilityState:'visible'}})
 return{lib:exports,status,calls,effects,respond(data){reply(data)}}
}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve))}

test('saved report readers deduplicate dashboard cards and keep dates and branch identities isolated',async()=>{
 const {lib,status,calls,effects,respond}=setup()
 lib.useDailySummary('2026-09-01','2026-09-01')
 lib.useDailySummary('2026-09-01','2026-09-01')
 effects.splice(0).forEach(fn=>fn())
 assert.equal(calls.length,1)
 assert.equal(calls[0].name,'printex_daily_report')
 respond({rows:[{day:'2026-09-01',branchId:'a',metric:'intake',dimension:'',count:3,meter:0,milliseconds:0}],pending:false})
 await flush()
 const saved=lib.useDailySummary('2026-09-01','2026-09-01')
 assert.equal(saved.loading,false)
 assert.equal(saved.rows[0].count,3)
 effects.splice(0).forEach(fn=>fn())
 assert.equal(calls.length,1)
 status.branchId='b'
 assert.equal(lib.useDailySummary('2026-09-01','2026-09-01').rows.length,0)
 effects.splice(0).forEach(fn=>fn())
 assert.equal(calls[1].args.p_branch,'b')
 respond({rows:[],pending:false});await flush()
 status.profile={id:'other',role:'admin'}
 assert.equal(lib.useDailySummary('2026-09-01','2026-09-01').loading,true)
})
test('pending or failed summaries never publish partial counts as complete',async()=>{
 const {lib,calls,effects,respond}=setup()
 lib.useDailySummary('2026-09-01','2026-09-02');effects.splice(0).forEach(fn=>fn())
 respond({rows:[{count:99}],pending:true});await flush()
 const result=lib.useDailySummary('2026-09-01','2026-09-02')
 assert.equal(result.rows.length,0)
 assert.match(result.error,/diperbarui/)
 void result.retry();assert.equal(calls.length,2)
 respond({rows:[],pending:false});await flush()
 assert.equal(lib.useDailySummary('2026-09-01','2026-09-02').error,'')
})
test('stored dates add across branches and periods, retain empty chart days and sum duration weights',()=>{
 const {lib}=setup()
 const rows=[
  {day:'2026-09-01',branchId:'a',metric:'output',dimension:'dtf',count:2,meter:100,milliseconds:0},
  {day:'2026-09-02',branchId:'b',metric:'output',dimension:'dtf',count:1,meter:20,milliseconds:0},
  {day:'2026-09-01',branchId:'a',metric:'timing',dimension:'PRINTING',count:2,meter:0,milliseconds:7200000},
  {day:'2026-09-02',branchId:'b',metric:'timing',dimension:'PRINTING',count:1,meter:0,milliseconds:1800000},
 ]
 assert.equal(lib.storedOutput(rows).dtf.meter,120)
 assert.equal(lib.storedOutput(rows,'b').dtf.count,1)
 const trend=lib.storedTrend(rows,'2026-09-01','2026-09-03')
 assert.equal(trend.length,3)
 assert.equal(trend[2].dtf.count,0)
 assert.equal(trend.reduce((sum,day)=>sum+day.dtf.meter,0),120)
 const timing=lib.total(rows,'timing','PRINTING')
 assert.equal(timing.milliseconds/timing.count,3000000)
})
