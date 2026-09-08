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
test('full workflow times every actual step and freezes at handover rather than archive finalization',()=>{
  let events=move(null,'incoming',0)
  const stages=['incoming','design','design_done','printing','press','done','archive']
  for(let i=1;i<stages.length;i++)events.push(...move(stages[i-1],stages[i],i))
  const result=orderTiming({...base,board_stage:'archive',archive:{archivedAt:at(6),finalizedAt:at(20)}},events,Date.parse(at(30)))
  assert.equal(result.totalMilliseconds,6*3600000)
  for(const stage of stages.slice(0,-1))assert.equal(result.stages[stage].milliseconds,3600000)
  assert.equal(result.stages.archive.milliseconds,0)
  assert.equal(result.finished,true)
})
test('skipped design and Press stay absent, elapsed time is attributed only to actual stages',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design_done',2),...move('design_done','printing',3),...move('printing','done',5)]
  const result=orderTiming({...base,board_stage:'done'},events,Date.parse(at(7)))
  assert.equal(result.totalMilliseconds,7*3600000)
  assert.equal(result.stages.design.visited,false)
  assert.equal(result.stages.press.visited,false)
  assert.equal(result.stages.incoming.milliseconds,2*3600000)
  assert.equal(result.stages.done.milliseconds,2*3600000)
  assert.equal(result.stages.done.running,true)
})
test('revisits sum all actual residence intervals without inflating total',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design',1),...move('design','design_done',2),...move('design_done','design',3),...move('design','design_done',5)]
  const result=orderTiming({...base,board_stage:'design_done'},events,Date.parse(at(6)))
  assert.equal(result.stages.design.milliseconds,3*3600000)
  assert.equal(result.stages.design_done.milliseconds,2*3600000)
  assert.equal(result.totalMilliseconds,6*3600000)
  assert.equal(Object.values(result.stages).reduce((sum,s)=>sum+s.milliseconds,0),result.totalMilliseconds)
})
test('duplicate and unordered events do not double duration; missing history is not fabricated',()=>{
  const events=[...move(null,'incoming',0),...move('incoming','design',1)]
  const result=orderTiming({...base,board_stage:'design'},[...events,...events].reverse(),Date.parse(at(2)))
  assert.equal(result.stages.incoming.milliseconds,3600000)
  assert.equal(result.stages.design.milliseconds,3600000)
  const missing=orderTiming({...base,board_stage:'printing'},[],Date.parse(at(3)))
  assert.equal(missing.stages.printing.visited,false)
  assert.equal(missing.totalMilliseconds,3*3600000)
  assert.equal(formatDuration(90061000),'1 hari 1 jam 1 mnt 1 dtk')
})
