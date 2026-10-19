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
const { productionCapacity, validateCapacitySettings, DEFAULT_CAPACITY_SETTINGS, defaultMachines, daysInRange } = load('./production-capacity.ts')
const machinesLib = load('./production-machines.ts')
const HOUR = 3_600_000
const measure = (meter, hours, count = 1) => ({ meter, milliseconds: hours * HOUR, count })
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)
const machine = (id, kind, name = id) => ({ id, kind, name })
// Working time 7,5 hours (as in the spreadsheet) unless a test sets other hours.
const settings = (effective = 7.5, available = effective) => ({ ...DEFAULT_CAPACITY_SETTINGS, effective_hours: effective, available_hours: available })
function capacity({ stations = {}, machines, own = {}, hours = 7.5, days = 1 }) {
  return productionCapacity({ days, stations, machines: machines ?? defaultMachines(), machineMeasures: new Map(Object.entries(own)), settings: settings(hours) })
}

test('matches the spreadsheet: Fedar 1 277,11 + Fedar 2 224,67 = 501,78; Press 512,65 so Sublim limits the system', () => {
  const T = 7.5, p1 = 277.11 / T, p2 = 224.67 / T, pPress = 512.65 / T
  const result = capacity({
    machines: [machine('f1', 'fedar', 'Fedar 1'), machine('f2', 'fedar', 'Fedar 2'), machine('d1', 'dtf'), machine('p1', 'press')],
    stations: { sublim: measure(p1 * 4 + p2 * 4, 8, 6), press: measure(pPress * 5, 5, 6) },
    own: { f1: measure(p1 * 4, 4, 3), f2: measure(p2 * 4, 4, 3) },
  })
  const [f1, f2] = result.machines.filter(row => row.process === 'sublim')
  close(f1.capacity, 277.11); close(f2.capacity, 224.67)
  assert.ok(f1.measured && f2.measured)
  close(result.processes.sublim.capacity, 501.78)
  close(result.processes.press.capacity, 512.65)
  close(result.system.capacity, 501.78)
  assert.equal(result.system.bottleneck, 'sublim')
  assert.equal(result.processes.sublim.machines, 2)
})

test('machines without their own data use the station average; press uses station P per machine', () => {
  const result = capacity({
    machines: [machine('f1', 'fedar'), machine('f2', 'fedar'), machine('d1', 'dtf'), machine('p1', 'press'), machine('p2', 'press')],
    stations: { sublim: measure(300, 6, 3), dtf: measure(80, 4, 2), press: measure(300, 3, 3) },
    own: { f1: measure(200, 2, 2) },
  })
  const f2 = result.machines.find(row => row.id === 'f2')
  assert.equal(f2.measured, false)
  close(f2.productivity, 50) // station: 300 m / 6 h
  close(result.processes.sublim.capacity, 100 * 7.5 + 50 * 7.5)
  close(result.processes.dtf.capacity, 20 * 7.5)
  close(result.processes.press.capacity, 100 * 7.5 * 2)
  close(result.processes.sublim.dailyOutput, 300)
  close(result.processes.sublim.utilization, 300 / 1125)
})

test('Press limits the line when it is slower than Sublim; output is averaged over the period days', () => {
  const result = capacity({
    machines: [machine('f1', 'fedar'), machine('p1', 'press')],
    stations: { sublim: measure(200, 2), press: measure(100, 2) },
    hours: 8, days: 2,
  })
  close(result.processes.sublim.capacity, 100 * 8)
  close(result.processes.press.capacity, 50 * 8)
  close(result.system.capacity, 400)
  assert.equal(result.system.bottleneck, 'press')
  close(result.system.dailyOutput, 100)
  close(result.system.efficiency, 100 / 400)
  assert.equal(result.effectiveHours, 8)
})

test('no machines means zero capacity; missing data stays unknown, never zero', () => {
  const none = capacity({ machines: [machine('f1', 'fedar'), machine('p1', 'press')] })
  assert.equal(none.processes.dtf.capacity, 0)
  assert.equal(none.processes.sublim.capacity, null)
  assert.equal(none.system.capacity, null)
  assert.equal(none.system.bottleneck, null)
  assert.deepEqual(defaultMachines().map(row => row.kind), ['fedar', 'fedar', 'dtf', 'press'])
})

test('settings validation and period length', () => {
  const standard = validateCapacitySettings({ ...DEFAULT_CAPACITY_SETTINGS, shift_hours: '9', planned_downtime_minutes: 120 })
  assert.deepEqual([standard.available_hours, standard.effective_hours], [9, 7])
  assert.equal(validateCapacitySettings({ ...DEFAULT_CAPACITY_SETTINGS, shift_hours: '8,5', planned_downtime_minutes: 90 }).effective_hours, 7)
  assert.equal(validateCapacitySettings({ ...DEFAULT_CAPACITY_SETTINGS, design_orders_per_hour: '2,5' }).design_orders_per_hour, 2.5)
  for (const bad of [{ shift_hours: 0 }, { shifts: 3, shift_hours: 9 }, { planned_downtime_minutes: 540 }, { planned_downtime_minutes: 1.5 }, { version: 0 }, { design_orders_per_hour: 0 }, { crew: { printing: 51 } }])
    assert.throws(() => validateCapacitySettings({ ...DEFAULT_CAPACITY_SETTINGS, ...bad }), JSON.stringify(bad))
  assert.equal(daysInRange('2026-10-01', '2026-10-01'), 1)
  assert.equal(daysInRange('2026-09-01', '2026-09-30'), 30)
  assert.equal(daysInRange('2026-10-02', '2026-10-01'), 0)
})

test('DTF prints only on DTF machines, every other material on Fedar; names and removal are guarded', () => {
  const { printMachineKind, printMachinesFor, validateMachineName, canRemoveMachine, nextMachineName } = machinesLib
  const list = [machine('f1', 'fedar', 'Fedar 1'), machine('f2', 'fedar', 'Fedar 2'), machine('d1', 'dtf', 'DTF 1'), machine('p1', 'press', 'Press 1')]
  assert.equal(printMachineKind(' dtf '), 'dtf')
  for (const type of ['Sublim', 'Batik', 'Jersey', 'Umbul-umbul']) assert.equal(printMachineKind(type), 'fedar')
  assert.deepEqual(printMachinesFor(list, 'DTF').map(row => row.id), ['d1'])
  assert.deepEqual(printMachinesFor(list, 'Jersey').map(row => row.id), ['f1', 'f2'])
  assert.equal(validateMachineName('  Fedar   3 ', list), 'Fedar 3')
  assert.throws(() => validateMachineName('fedar 2', list), /sudah dipakai/)
  assert.equal(validateMachineName('Fedar 2', list, 'f2'), 'Fedar 2')
  assert.throws(() => validateMachineName(' ', list)); assert.throws(() => validateMachineName('x'.repeat(41), list))
  assert.equal(canRemoveMachine(list, list[0]), true)
  assert.equal(canRemoveMachine(list, list[2]), false, 'Last DTF machine is required for DTF orders')
  assert.equal(canRemoveMachine(list, list[3]), true, 'Press is not required to enter printing')
  assert.equal(canRemoveMachine(list.slice(1), list[1]), false, 'The last Fedar machine is required for Sublim orders')
  assert.equal(nextMachineName(list, 'fedar'), 'Fedar 3')
  assert.equal(nextMachineName(list, 'press'), 'Press 2')
})

test('design capacity uses available hours, effective capacity the hours after break and setup', () => {
  const result = productionCapacity({ days: 1, settings: settings(7.5, 8), machines: [machine('f1', 'fedar'), machine('p1', 'press')],
    stations: { sublim: measure(300, 10), press: measure(300, 5) }, machineMeasures: new Map([['f1', measure(300, 10)]]) })
  const fedar = result.machines.find(row => row.id === 'f1')
  assert.deepEqual([fedar.designCapacity, fedar.capacity], [240, 225])
  assert.deepEqual([result.processes.press.designCapacity, result.processes.press.capacity], [480, 450])
  assert.deepEqual([result.system.designCapacity, result.system.capacity, result.system.bottleneck], [240, 225, 'sublim'])
  close(result.processes.sublim.utilization, 300 / 240)
  close(result.processes.sublim.efficiency, 300 / 225)
  assert.equal(result.availableHours, 8)
})
