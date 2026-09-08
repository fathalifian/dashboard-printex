import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('./process-metrics.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const metrics = {}
new Function('exports', compiled)(metrics)
const { transitionEvents, summarizeEvents, jakartaDate } = metrics
const order = { id: '1', spk_code: 'SPK-1', customer: { name: 'Customer' } }

test('a completion today is counted independently from yesterday intake in WIB', () => {
  const events = [...transitionEvents(order, 'incoming', 'design', '2026-09-06T16:00:00Z'), ...transitionEvents(order, 'design', 'design_done', '2026-09-06T18:00:00Z')]
  const daily = summarizeEvents(events, 'design', '2026-09-07', '2026-09-07')
  assert.equal(daily.entered, 0)
  assert.equal(daily.completed, 1)
  const weekly = summarizeEvents(events, 'design', '2026-09-01', '2026-09-07')
  assert.equal(weekly.entered, 1)
  assert.equal(weekly.completed, 1)
})
test('same-stage moves do not duplicate work and backwards moves are revisions', () => {
  assert.equal(transitionEvents(order, 'design', 'design', '2026-09-07T00:00:00Z').length, 0)
  const events = transitionEvents(order, 'printing', 'design', '2026-09-07T00:00:00Z')
  assert.equal(events[0].kind, 'returned')
  assert.equal(events[1].kind, 'entered')
  assert.equal(events.filter(e => e.kind === 'completed').length, 0)
})
test('skipped stages are not reported as completed; new orders only have intake', () => {
  const events = transitionEvents(order, 'incoming', 'printing', '2026-09-07T00:00:00Z')
  assert.deepEqual(events.map(e => e.stage), ['incoming', 'printing'])
  assert.equal(transitionEvents(order, null, 'incoming', '2026-09-07T00:00:00Z').length, 1)
})
test('WIB midnight, inclusive date boundaries and empty ranges', () => {
  assert.equal(jakartaDate('2026-09-06T17:00:00Z'), '2026-09-07')
  const events = transitionEvents(order, null, 'design', '2026-09-06T17:00:00Z')
  assert.equal(summarizeEvents(events, 'design', '2026-09-07', '2026-09-07').entered, 1)
  assert.equal(summarizeEvents(events, 'design', '2026-09-08', '2026-09-09').entered, 0)
})

test('repeated back-and-forth movements count one order per process metric', () => {
  const events = [
    ...transitionEvents(order, 'incoming', 'design', '2026-09-07T01:00:00Z'),
    ...transitionEvents(order, 'design', 'design_done', '2026-09-07T02:00:00Z'),
    ...transitionEvents(order, 'design_done', 'design', '2026-09-07T03:00:00Z'),
    ...transitionEvents(order, 'design', 'design_done', '2026-09-07T04:00:00Z'),
  ]
  const stats = summarizeEvents(events, 'design', '2026-09-07', '2026-09-07')
  assert.equal(stats.entered, 1)
  assert.equal(stats.completed, 1)
  assert.equal(stats.events.length, 2)
})

test('deduplicate before date filtering; daily counts add up to weekly totals', () => {
  const events = [
    ...transitionEvents(order, 'incoming', 'design', '2026-09-06T01:00:00Z'),
    ...transitionEvents(order, 'design', 'design_done', '2026-09-06T02:00:00Z'),
    ...transitionEvents(order, 'design_done', 'design', '2026-09-07T01:00:00Z'),
    ...transitionEvents(order, 'design', 'design_done', '2026-09-07T02:00:00Z'),
  ].reverse()
  const later = summarizeEvents(events, 'design', '2026-09-07', '2026-09-07')
  const earlier = summarizeEvents(events, 'design', '2026-09-06', '2026-09-06')
  const week = summarizeEvents(events, 'design', '2026-09-01', '2026-09-07')
  assert.equal(later.entered, 0)
  assert.equal(later.completed, 0)
  assert.equal(week.entered, earlier.entered + later.entered)
  assert.equal(week.completed, earlier.completed + later.completed)
  assert.equal(week.completed, 1)
})

test('identity survives renamed SPK; distinct IDs are still distinct orders', () => {
  const renamed = { ...order, spk_code: 'SPK-NEW' }
  const second = { ...order, id: '2' }
  const events = [
    ...transitionEvents(order, 'incoming', 'design', '2026-09-07T01:00:00Z'),
    ...transitionEvents(renamed, 'incoming', 'design', '2026-09-07T02:00:00Z'),
    ...transitionEvents(second, 'incoming', 'design', '2026-09-07T03:00:00Z'),
  ]
  assert.equal(summarizeEvents(events, 'design', '2026-09-07', '2026-09-07').entered, 2)
})

test('first actor owns milestone even when a different employee repeats the move', () => {
  const first = transitionEvents(order, 'incoming', 'design', '2026-09-07T01:00:00Z').map(e => ({ ...e, actorName: 'A' }))
  const repeat = transitionEvents(order, 'incoming', 'design', '2026-09-07T02:00:00Z').map(e => ({ ...e, actorName: 'B' }))
  const unique = metrics.uniqueProcessEvents([...repeat, ...first])
  assert.equal(unique.filter(e => e.actorName === 'B').length, 0)
  assert.equal(summarizeEvents(unique.filter(e => e.actorName === 'A'), 'design', '2026-09-07', '2026-09-07').entered, 1)
})

test('process report excludes all revisions and archive intake, and uses archive completion date', () => {
  const history = [
    ...transitionEvents(order, 'printing', 'design', '2026-09-07T01:00:00Z'),
    ...transitionEvents(order, 'done', 'archive', '2026-09-07T02:00:00Z'),
  ]
  const orders = [{ ...order, board_stage: 'archive', archive: { finalizedAt: '2026-09-07T17:05:00Z' } }]
  const report = metrics.processReportEvents(history, orders)
  assert.equal(report.some(event => event.kind === 'returned'), false)
  assert.equal(report.some(event => event.stage === 'archive' && event.kind === 'entered'), false)
  assert.equal(summarizeEvents(report, 'archive', '2026-09-07', '2026-09-07').completed, 0)
  assert.equal(summarizeEvents(report, 'archive', '2026-09-08', '2026-09-08').completed, 1)
  assert.equal(summarizeEvents(report, 'design', '2026-09-07', '2026-09-07').entered, 1)
  assert.ok(history.some(event => event.kind === 'returned'))
})

test('pending archives are not completed; duplicate archive records count only once', () => {
  const pending = { ...order, board_stage: 'archive', archive: {} }
  assert.equal(metrics.processReportEvents([], [pending]).length, 0)
  const finalized = { ...pending, archive: { finalizedAt: '2026-09-08T01:00:00Z' } }
  const report = metrics.processReportEvents([], [finalized, finalized])
  assert.equal(summarizeEvents(report, 'archive', '2026-09-01', '2026-09-08').completed, 1)
})

test('skipped design and Press have no report intake or completion',()=>{
  const events=[...transitionEvents(order,'incoming','design_done','2026-09-08T01:00:00Z'),...transitionEvents(order,'printing','done','2026-09-08T02:00:00Z')]
  for(const stage of ['design','press']) {
    const summary=summarizeEvents(events,stage,'2026-09-08','2026-09-08')
    assert.equal(summary.entered,0)
    assert.equal(summary.completed,0)
  }
})
