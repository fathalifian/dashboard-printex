import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const exports = {}
new Function('exports', ts.transpileModule(readFileSync(new URL('./production-efficiency.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(exports)
const { ratio, roundTo, percent, workingHours, capacityFor, capacityUse, lineCapacity, stationLoad, findBottleneck, productivity, growth, previousPeriod } = exports
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('Fedar example: design 640 m, effective 560 m, utilization 65,6%, efficiency 75,0%', () => {
  const hours = workingHours({ shifts: 1, shiftHours: 16, plannedDowntimeMinutes: 120 })
  assert.deepEqual(hours, { available: 16, plannedDowntime: 2, effective: 14 })
  const capacity = capacityFor({ speed: 40, availableHours: hours.available, effectiveHours: hours.effective, days: 1 })
  assert.deepEqual(capacity, { design: 640, effective: 560 })
  const use = capacityUse({ output: 420, ...capacity, load: 500 })
  assert.equal(percent(use.utilization), 65.6)
  assert.equal(percent(use.efficiency), 75)
  assert.equal(use.remaining, 60)
})

test('Press 50 m/jam × 14 jam = 700 m; line = MIN(560, 700) = 560 limited by Sublim', () => {
  const press = capacityFor({ speed: 50, availableHours: 16, effectiveHours: 14, days: 1 })
  assert.equal(press.effective, 700)
  assert.deepEqual(lineCapacity(560, press.effective), { capacity: 560, limiter: 'sublim' })
  assert.deepEqual(lineCapacity(800, 700), { capacity: 700, limiter: 'press' })
  assert.deepEqual(lineCapacity(null, 700), { capacity: null, limiter: null })
})

test('bottleneck is the highest load; above 100% is critical', () => {
  assert.deepEqual(stationLoad(600, 560), { load: 600 / 560, critical: true })
  assert.deepEqual(stationLoad(280, 560), { load: 0.5, critical: false })
  assert.deepEqual(stationLoad(100, null), { load: null, critical: false })
  assert.deepEqual(findBottleneck([{ id: 'sublim', load: 0.9 }, { id: 'press', load: 0.6 }, { id: 'dtf', load: null }]), { id: 'sublim', load: 0.9 })
  assert.equal(findBottleneck([{ id: 'press', load: null }]), null)
  assert.equal(findBottleneck([{ id: 'sublim', load: 0.5 }, { id: 'press', load: 0.5 }]).id, 'sublim', 'Ties keep the upstream station')
})

test('productivity, growth and the previous period', () => {
  assert.equal(productivity(420, 12.5), 33.6)
  assert.equal(productivity(0, 5), null)
  assert.equal(productivity(100, 0), null)
  close(growth(12, 10), 0.2)
  close(growth(8, 10), -0.2)
  assert.equal(growth(5, 0), null)
  assert.equal(growth(null, 10), null)
  assert.deepEqual(previousPeriod('2026-10-13', '2026-10-15'), { start: '2026-10-10', end: '2026-10-12' })
  assert.deepEqual(previousPeriod('2026-10-01', '2026-10-01'), { start: '2026-09-30', end: '2026-09-30' })
  assert.equal(previousPeriod('2026-10-05', '2026-10-01'), null)
})

test('safe division, rounding and edge cases', () => {
  assert.equal(ratio(1, 0), null)
  assert.equal(ratio(null, 5), null)
  assert.equal(ratio(Number.NaN, 5), null)
  assert.equal(roundTo(71.25), 71.3)
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3)
  assert.equal(percent(null), null)
  assert.deepEqual(capacityFor({ speed: 40, availableHours: 8, effectiveHours: 7.5, days: 0 }), { design: null, effective: null })
  assert.deepEqual(capacityFor({ speed: null, availableHours: 8, effectiveHours: 7.5, days: 3 }), { design: null, effective: null })
  assert.equal(workingHours({ shifts: 1, shiftHours: 1, plannedDowntimeMinutes: 60 }).effective, null)
})
