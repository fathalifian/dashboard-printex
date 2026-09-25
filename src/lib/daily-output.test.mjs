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
const { dailyOutput } = compile('./daily-output.ts', { './process-metrics': metrics })
const order = (id, production_type, meter) => ({ id, production_type, meter, board_stage: 'archive', archive: { finalizedAt: '2026-09-26T00:00:00Z' } })
const event = (orderId, occurredAt, stage = 'printing', kind = 'completed') => ({ id: `${orderId}-${occurredAt}`, orderId, occurredAt, stage, kind })

test('custom range includes both boundary dates in WIB without counting repeats', () => {
  const orders = [order('1', 'DTF', 2), order('2', 'Batik', 3), order('3', 'DTF', 9)]
  const history = [event('1', '2026-09-24T17:00:00Z'), event('1', '2026-09-26T04:00:00Z'), event('2', '2026-09-26T16:59:59Z'), event('3', '2026-09-26T17:00:00Z')]
  assert.deepEqual(dailyOutput(orders, history, '2026-09-25', '2026-09-26'), { dtf: { meter: 2, count: 1 }, sublim: { meter: 3, count: 1 } })
})

test('groups DTF separately from every other type and includes archived orders', () => {
  const orders = [order('1', 'DTF', 2.5), order('2', 'Umbul Umbul', 10), order('3', 'Batik', 4.25), order('4', 'Lainnya', 1)]
  const result = dailyOutput(orders, orders.map(o => event(o.id, '2026-09-25T03:00:00Z')), '2026-09-25')
  assert.deepEqual(result, { dtf: { meter: 2.5, count: 1 }, sublim: { meter: 15.25, count: 3 } })
})

test('uses print completion date in WIB, not entry, return, or final order completion', () => {
  const orders = [order('1', 'DTF', 2), order('2', 'Batik', 3)]
  const history = [event('1', '2026-09-24T17:00:00Z'), event('2', '2026-09-25T17:00:00Z'), event('2', '2026-09-25T04:00:00Z', 'printing', 'returned'), event('2', '2026-09-25T04:00:00Z', 'printing', 'entered'), event('2', '2026-09-25T04:00:00Z', 'done', 'entered')]
  assert.deepEqual(dailyOutput(orders, history, '2026-09-25'), { dtf: { meter: 2, count: 1 }, sublim: { meter: 0, count: 0 } })
})

test('repeat completions cannot inflate output on the same day or another day', () => {
  const orders = [order('1', 'DTF', 2)]
  const history = [event('1', '2026-09-26T03:00:00Z'), event('1', '2026-09-25T04:00:00Z'), event('1', '2026-09-25T03:00:00Z')]
  assert.equal(dailyOutput(orders, history, '2026-09-25').dtf.meter, 2)
  assert.equal(dailyOutput(orders, history, '2026-09-26').dtf.count, 0)
  assert.deepEqual(dailyOutput([], history, '2026-09-25'), { dtf: { meter: 0, count: 0 }, sublim: { meter: 0, count: 0 } })
})
