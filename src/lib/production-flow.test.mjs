import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function compile(file, imports = {}) {
  const exports = {}
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', compiled)(exports, name => imports[name])
  return exports
}
const metrics = compile('./process-metrics.ts')
const { productionFlow } = compile('./production-flow.ts', { './process-metrics': metrics })
const event = (orderId, stage, kind, hour) => ({ id: `${orderId}-${stage}-${kind}-${hour}`, orderId, stage, kind, occurredAt: new Date(hour * 3600000).toISOString() })
const order = (id, board_stage, archive = null) => ({ id, board_stage, archive })
test('empty and missing history are not zero-duration samples or bottlenecks', () => {
  const rows = productionFlow([order('1', 'design')], [], 10 * 3600000)
  assert.equal(rows.length, 7)
  assert.equal(rows[1].average, null)
  assert.equal(rows[1].count, 1)
  assert.equal(rows[1].bottleneck, false)
  assert.equal(rows[1].piling, false)
})
test('revisits, duplicate entries and unsorted transitions preserve elapsed durations', () => {
  const events = [event('1', 'design', 'entered', 1), event('1', 'design', 'entered', 2), event('1', 'design', 'completed', 3), event('1', 'design_done', 'entered', 3), event('1', 'design_done', 'returned', 4), event('1', 'design', 'entered', 4), event('1', 'design', 'completed', 8)]
  const rows = productionFlow([], events.reverse(), 10 * 3600000)
  assert.equal(rows[1].samples, 2)
  assert.equal(rows[1].average, 3 * 3600000)
  assert.equal(rows[2].average, null)
})
test('signals require evidence; completed stages never signal production congestion', () => {
  const events = ['1', '2', '3'].flatMap(id => [event(id, 'design', 'entered', 1), event(id, 'design', 'completed', 2)])
  events.push(event('4', 'design', 'entered', 3))
  const orders = [order('4', 'design'), order('5', 'design'), order('6', 'done'), order('7', 'done')]
  const rows = productionFlow(orders, events, 6 * 3600000)
  assert.equal(rows[1].bottleneck, true)
  assert.equal(rows[1].piling, true)
  assert.equal(rows[5].piling, false)
  assert.equal(productionFlow(orders, events.slice(2), 6 * 3600000)[1].bottleneck, false)
})
test('finalized archive duration stops and finalized orders leave board counts', () => {
  const rows = productionFlow([order('1', 'archive', { finalizedAt: new Date(5 * 3600000).toISOString() })], [event('1', 'archive', 'entered', 2)], 10 * 3600000)
  assert.equal(rows[6].count, 0)
  assert.equal(rows[6].average, 3 * 3600000)
  assert.equal(rows[6].samples, 1)
})

test('period uses completion date in WIB, retains earlier entries and live board durations', () => {
  const events = [event('1', 'design', 'entered', 10), event('1', 'design', 'completed', 17), event('2', 'design', 'entered', 15), event('2', 'design', 'completed', 16), event('3', 'design', 'entered', 18)]
  const orders = [order('3', 'design')]
  const selected = productionFlow(orders, events, 30 * 3600000, { start: '1970-01-02', end: '1970-01-02' })[1]
  assert.equal(selected.samples, 1)
  assert.equal(selected.average, 7 * 3600000)
  assert.deepEqual(selected.waiting, [12 * 3600000])
  const other = productionFlow(orders, events, 30 * 3600000, { start: '1970-01-01', end: '1970-01-01' })[1]
  assert.equal(other.average, 3600000)
  assert.deepEqual(other.waiting, selected.waiting)
  assert.equal(other.count, selected.count)
})

test('empty periods, skipped stages and returns never become completed samples', () => {
  const events = [event('1', 'design', 'entered', 1), event('1', 'design', 'returned', 3), event('1', 'incoming', 'entered', 3), event('1', 'design_done', 'entered', 4)]
  const all = productionFlow([], events, 30 * 3600000)
  assert.equal(all[1].samples, 0)
  assert.equal(all[0].average, 3600000)
  const empty = productionFlow([], events, 30 * 3600000, { start: '1970-01-02', end: '1970-01-02' })
  assert.ok(empty.every(row => row.average === null))
})

test('archive period follows finalization date without counting completion twice', () => {
  const orders = [order('1', 'archive', { finalizedAt: new Date(18 * 3600000).toISOString() })]
  const events = [event('1', 'archive', 'entered', 10), event('1', 'archive', 'completed', 18)]
  assert.equal(productionFlow(orders, events, 30 * 3600000, { start: '1970-01-02', end: '1970-01-02' })[6].samples, 1)
  assert.equal(productionFlow(orders, events, 30 * 3600000, { start: '1970-01-01', end: '1970-01-01' })[6].samples, 0)
})
