import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(name) {
  const exports = {}
  new Function('exports', 'require', ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, dependency => dependency === './production-efficiency' ? load('./production-efficiency.ts') : {})
  return exports
}
const { parseEfficiencyInputs, laborProductivity, stationLoads } = load('./production-metrics.ts')
const HOUR = 3_600_000

test('labour productivity: run meters ÷ man-hours; machine productivity: run meters ÷ running hours', () => {
  const inputs = parseEfficiencyInputs({
    runs: [
      { machineId: 'f1', stage: 'printing', milliseconds: 6 * HOUR, meter: 210, count: 7 },
      { machineId: 'd1', stage: 'printing', milliseconds: 3 * HOUR, meter: 30, count: 3 },
      { machineId: null, stage: 'press', milliseconds: 3 * HOUR, meter: 210, count: 7 },
    ],
    shifts: [{ stage: 'printing', manHours: 15, peopleDays: 2 }, { stage: 'press', manHours: 7.5, peopleDays: 1 }, { stage: 'dtf', manHours: 7.5, peopleDays: 1 }, { stage: 'design', manHours: 8, peopleDays: 1 }],
  })
  const kind = { f1: 'sublim', d1: 'dtf' }
  const result = laborProductivity({ inputs, machineProcess: machine => kind[machine] ?? null })
  assert.equal(result.output, 240)
  assert.equal(result.manHours, 30, 'Design man-hours are not production hours')
  assert.equal(result.perManHour, 8)
  assert.equal(result.perMachineHour, 240 / 9)
  assert.equal(result.ordersPerOperatorDay, 10 / 4)
  assert.equal(result.stations.press.perMachineHour, 70)
  assert.equal(laborProductivity({ inputs: parseEfficiencyInputs({}), machineProcess: () => null }).perManHour, null)
})

test('station load counts period intake plus older backlog; DTF only loads DTF; highest load is the bottleneck', () => {
  const order = (stage, type, meter, date, state = 'active') => ({ board_stage: stage, production_type: type, meter, order_date: date, order_state: state, archive: null })
  const orders = [
    order('printing', 'Jersey', 300, '2026-10-15'),
    order('done', 'Jersey', 200, '2026-10-15', 'completed'),
    order('design', 'Sublim', 150, '2026-10-10'),            // older backlog before Sublim
    order('press', 'Sublim', 100, '2026-10-09'),             // older, already past Sublim: Press backlog only
    order('done', 'Sublim', 999, '2026-10-01', 'completed'), // older and finished: no load
    order('printing', 'DTF', 40, '2026-10-15'),
    order('incoming', 'Jersey', 50, '2026-10-15', 'cancelled'),
  ]
  const result = stationLoads({ orders, start: '2026-10-15', end: '2026-10-15', days: 1, capacityPerDay: { sublim: 560, press: 700, dtf: 80 }, designPerDay: 10, includeDesign: false })
  const row = name => result.rows.find(item => item.id === name)
  assert.equal(row('sublim').demand, 650)
  assert.equal(row('press').demand, 750)
  assert.equal(row('dtf').demand, 40)
  assert.deepEqual([row('sublim').critical, row('press').critical], [true, true])
  assert.equal(result.bottleneck.id, 'sublim', '650/560 = 116% is above 750/700 = 107%')
  assert.deepEqual([row('sublim').wip, row('press').wip, row('dtf').wip], [1, 1, 1])
  assert.equal(row('design'), undefined, 'Design only joins when included and its capacity is set')
  const withDesign = stationLoads({ orders, start: '2026-10-15', end: '2026-10-15', days: 1, capacityPerDay: { sublim: null, press: 700, dtf: 80 }, designPerDay: 2, includeDesign: true })
  const design = withDesign.rows.find(item => item.id === 'design')
  assert.deepEqual([design.unit, design.demand, design.load], ['order', 4, 2], 'Design counts orders: 3 in the period + 1 older order still in design')
  assert.equal(withDesign.rows.find(item => item.id === 'sublim').load, null, 'Unknown capacity gives an unknown load')
  assert.equal(withDesign.bottleneck.id, 'design')
})
