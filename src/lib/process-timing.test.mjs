import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const modules={}
function load(name){
  if(modules[name])return modules[name]
  const exports={};modules[name]=exports
  const source=readFileSync(new URL(name+'.ts',import.meta.url),'utf8')
  new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,load)
  return exports
}
const {orderTiming,formatDuration}=load('./process-timing')
const {transitionEvents}=load('./process-metrics')
const base={id:'a',spk_code:'A',customer:{name:'Customer'},created_at:'2026-09-08T00:00:00Z',board_stage:'incoming',archive:null}
const at=hours=>new Date(Date.parse(base.created_at)+hours*3600000).toISOString()
const move=(from,to,hours)=>transitionEvents(base,from,to,at(hours))
test('production starts at Design and freezes at Done before handover or archive finalization',()=>{
  let events=move(null,'incoming',0)
  const stages=['incoming','design','design_done','printing','press','done','archive']
  for(let i=1;i<stages.length;i++)events.push(...move(stages[i-1],stages[i],i))
  const result=orderTiming({...base,board_stage:'archive',archive:{archivedAt:at(6),finalizedAt:at(20)}},events,Date.parse(at(30)))
  assert.equal(result.totalMilliseconds,4*3600000)
  for(const stage of stages.slice(1,-2))assert.equal(result.stages[stage].milliseconds,3600000)
  assert.equal(result.stages.archive.milliseconds,0)
  assert.equal(result.finished,true)
})
test('skipped design and Press stay absent, elapsed time is attributed only to actual stages',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design_done',2),...move('design_done','printing',3),...move('printing','done',5)]
  const result=orderTiming({...base,board_stage:'done'},events,Date.parse(at(7)))
  assert.equal(result.totalMilliseconds,3*3600000)
  assert.equal(result.stages.design.visited,false)
  assert.equal(result.stages.press.visited,false)
  assert.equal(result.stages.incoming.milliseconds,0)
  assert.equal(result.stages.done.milliseconds,0)
  assert.equal(result.stages.done.running,false)
})
test('revisits sum all actual residence intervals without inflating total',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design',1),...move('design','design_done',2),...move('design_done','design',3),...move('design','design_done',5)]
  const result=orderTiming({...base,board_stage:'design_done'},events,Date.parse(at(6)))
  assert.equal(result.stages.design.milliseconds,3*3600000)
  assert.equal(result.stages.design_done.milliseconds,2*3600000)
  assert.equal(result.totalMilliseconds,5*3600000)
  assert.equal(Object.values(result.stages).reduce((sum,s)=>sum+s.milliseconds,0),result.totalMilliseconds)
})
test('duplicate and unordered events do not double duration; missing history is not fabricated',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design',1)]
  const result=orderTiming({...base,board_stage:'design'},[...events,...events].reverse(),Date.parse(at(2)))
  assert.equal(result.stages.incoming.milliseconds,0)
  assert.equal(result.stages.design.milliseconds,3600000)
  const missing=orderTiming({...base,board_stage:'printing'},[],Date.parse(at(3)))
  assert.equal(missing.stages.printing.visited,false)
  assert.equal(missing.totalMilliseconds,null)
  assert.equal(formatDuration(90061000),'1 hari 1 jam 1 mnt 1 dtk')
})

test('incoming is not timed, and the first Done freezes totals even after later movement',()=>{
  const incoming=orderTiming(base,move(null,'incoming',0),Date.parse(at(20)))
  assert.equal(incoming.totalMilliseconds,null)
  assert.equal(incoming.stages.incoming.visited,false)
  const events=[...move(null,'incoming',0),...move('incoming','design_done',2),...move('design_done','printing',3),...move('printing','done',5),...move('done','press',8),...move('press','done',10)]
  for(const clock of [12,24,72]) {
    const result=orderTiming({...base,board_stage:'done'},events,Date.parse(at(clock)))
    assert.equal(result.totalMilliseconds,3*3600000)
    assert.equal(result.completedAt,at(5))
    assert.equal(result.stages.press.visited,false)
  }
})
test('finished orders missing a start or completion timestamp do not get fabricated totals',()=>{
  assert.equal(orderTiming({...base,board_stage:'done'},move('printing','done',5),Date.parse(at(12))).totalMilliseconds,null)
  assert.equal(orderTiming({...base,board_stage:'done'},move('incoming','design',2),Date.parse(at(12))).totalMilliseconds,null)
})
const {createOrderTimingReader}=load('./process-timing')
test('cached timing matches full calculation across ticks, future events, revisits and clock rollback',()=>{
 const histories=[[],move(null,'design',1),[...move(null,'design',1),...move('design','printing',3),...move('printing','design',5)], [...move(null,'design_done',1),...move('design_done','printing',2),...move('printing','done',6)]]
 for(const board_stage of ['incoming','design','printing','done','archive'])for(const history of histories){
  const order={...base,board_stage},read=createOrderTimingReader(order,history)
  for(const hour of [0,1,1.5,2,2.5,3,4,5,5.5,6,10,2,11])assert.deepEqual(read(Date.parse(at(hour))),orderTiming(order,history,Date.parse(at(hour))))
 }
})
test('ordinary timer ticks do not scan history again and never mutate prior snapshots',()=>{
 let scans=0
 const history=new Proxy(move(null,'design',1),{get(target,key,receiver){if(key==='filter')scans++;return Reflect.get(target,key,receiver)}})
 const read=createOrderTimingReader({...base,board_stage:'design'},history)
 const first=read(Date.parse(at(2))),before=structuredClone(first),initialScans=scans
 for(let second=1;second<=60;second++)read(Date.parse(at(2))+second*1000)
 assert.equal(scans,initialScans)
 assert.deepEqual(first,before)
 assert.equal(read(Date.parse(at(3))).stages.design.milliseconds,2*3600000)
})
