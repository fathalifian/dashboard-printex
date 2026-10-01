import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const modules = {}
function load(name) {
  if (modules[name]) return modules[name]
  const exports = {}; modules[name] = exports
  const source = readFileSync(new URL(name + '.ts', import.meta.url), 'utf8')
  new Function('exports', 'require', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, load)
  return exports
}
const { summarizeProductivity, productivityRows, normalizeProductivityPaperWidth } = load('./productivity')
const { transitionEvents } = load('./process-metrics')
const { orderTiming } = load('./process-timing')
const HOUR = 3_600_000
const day = '2026-09-25'
const at = hours => new Date(Date.parse(`${day}T00:00:00+07:00`) + hours * HOUR).toISOString()
const order = (id = 'a', overrides = {}) => ({
  id, spk_code: `SPK-${id}`, customer: { name: 'Customer' }, production_type: 'Batik',
  paper_width: '1.2', meter: 100, created_at: at(-48), order_date: '2026-09-23',
  board_stage: 'done', archive: null, ...overrides,
})
const move = (item, from, to, hour) => transitionEvents(item, from, to, at(hour))
function history(item, printStart = 1, printEnd = 3, pressEnd = 4) {
  return [
    ...move(item, null, 'design_done', printStart - 1),
    ...move(item, 'design_done', 'printing', printStart),
    ...move(item, 'printing', item.production_type === 'DTF' ? 'done' : 'press', printEnd),
    ...(item.production_type === 'DTF' ? [] : move(item, 'press', 'done', pressEnd)),
  ]
}
const summaryRow = (meter, hours) => ({
  orderId: 'a', spkCode: 'A', productionType: 'Batik', paperWidth: '1.2',
  process: 'sublim', meter, durationMilliseconds: hours * HOUR,
})

test('100 meters in 2 hours gives 50 m/hour and 72 seconds/meter', () => {
  const result = summarizeProductivity([summaryRow(100, 2)])
  assert.deepEqual(result, {
    orderCount: 1, totalMeter: 100, totalMilliseconds: 2 * HOUR, hours: 2,
    productivity: 50, cycleTimeSecondsPerMeter: 72, averageDurationMilliseconds: 2 * HOUR,
  })
})

test('weighted cycle time and productivity divide totals, not per-order averages', () => {
  const result = summarizeProductivity([summaryRow(100, 2), summaryRow(300, 1)])
  assert.equal(result.cycleTimeSecondsPerMeter, 27)
  assert.notEqual(result.cycleTimeSecondsPerMeter, (72 + 12) / 2)
  assert.equal(result.productivity, 400 / 3)
  assert.equal(result.averageDurationMilliseconds, 1.5 * HOUR)
  assert.equal(result.orderCount, 2)
})

test('zero duration, zero meter and empty samples never divide by zero', () => {
  assert.equal(summarizeProductivity([summaryRow(100, 0)]).productivity, null)
  assert.equal(summarizeProductivity([summaryRow(100, 0)]).cycleTimeSecondsPerMeter, 0)
  for (const duration of [0, 2]) {
    const result = summarizeProductivity([summaryRow(0, duration)])
    assert.equal(result.productivity, null)
    assert.equal(result.cycleTimeSecondsPerMeter, null)
  }
  assert.deepEqual(summarizeProductivity([]), {
    orderCount: 0, totalMeter: 0, totalMilliseconds: 0, hours: 0,
    productivity: null, cycleTimeSecondsPerMeter: null, averageDurationMilliseconds: null,
  })
})

test('invalid numeric inputs do not propagate NaN or Infinity', () => {
  const result = summarizeProductivity([summaryRow(NaN, Infinity), summaryRow(-10, -1)])
  assert.equal(result.totalMeter, 0)
  assert.equal(result.totalMilliseconds, 0)
  assert.equal(result.productivity, null)
})

test('running printing or press stages are excluded; closed printing still counts during press', () => {
  const printing = order('printing', { board_stage: 'printing' })
  const press = order('press', { board_stage: 'press' })
  const events = [
    ...move(printing, null, 'design_done', 0), ...move(printing, 'design_done', 'printing', 1),
    ...move(press, null, 'design_done', 0), ...move(press, 'design_done', 'printing', 1),
    ...move(press, 'printing', 'press', 3),
  ]
  const result = productivityRows([printing, press], events, day, day)
  assert.deepEqual(result.sublim.map(row => row.orderId), ['press'])
  assert.equal(result.sublim[0].durationMilliseconds, 2 * HOUR)
  assert.equal(result.press.length, 0)
})

test('running revisit is excluded even when an earlier lastExit exists', () => {
  const item = order('a', { board_stage: 'printing' })
  const events = [
    ...move(item, null, 'design_done', 0), ...move(item, 'design_done', 'printing', 1),
    ...move(item, 'printing', 'design_done', 2), ...move(item, 'design_done', 'printing', 3),
  ]
  assert.equal(productivityRows([item], events, day, day).sublim.length, 0)
})

test('period uses each stage lastExit in Jakarta, inclusive of both date boundaries', () => {
  const items = ['before', 'start', 'end', 'after'].map(id => order(id, { production_type: 'DTF' }))
  const exits = [-1 / 3600, 0, 24 - 1 / 3600, 24]
  const events = items.flatMap((item, index) => history(item, exits[index] - 2, exits[index]))
  const result = productivityRows(items, events, day, day)
  assert.deepEqual(result.dtf.map(row => row.orderId), ['start', 'end'])
  assert.equal(summarizeProductivity(result.dtf).hours, 4)
  assert.equal(productivityRows(items, events, '2026-09-27', '2026-09-26').dtf.length, 0)
})

test('printing and press are selected independently, regardless of order_date', () => {
  const item = order()
  const result = productivityRows([item], history(item, 22, 23, 25), day, day)
  assert.equal(result.sublim.length, 1)
  assert.equal(result.press.length, 0)
  const tomorrow = productivityRows([item], history(item, 22, 23, 25), '2026-09-26', '2026-09-26')
  assert.equal(tomorrow.sublim.length, 0)
  assert.equal(tomorrow.press.length, 1)
})

test('paper width normalizes decimal strings; filter narrows non-DTF including Press', () => {
  const items = ['1.2', '1.20', ' 1,2 ', '1.6', '1.8', null].map((width, index) => order(String(index), { paper_width: width }))
  const events = items.flatMap(item => history(item))
  const result = productivityRows(items, events, day, day, '1.2')
  assert.deepEqual(result.sublim.map(row => row.orderId), ['0', '1', '2'])
  assert.ok(result.sublim.every(row => row.paperWidth === '1.2'))
  assert.equal(result.press.length, 3)
  assert.equal(productivityRows(items, events, day, day).sublim.length, 6)
  assert.equal(normalizeProductivityPaperWidth('1.60'), '1.6')
  assert.equal(normalizeProductivityPaperWidth('1,8'), '1.8')
  assert.equal(normalizeProductivityPaperWidth('unknown'), null)
})

test('DTF bypassing Press only contributes to DTF, also with non-DTF paper filter', () => {
  const item = order('dtf', { production_type: 'DTF', paper_width: '0.6' })
  const result = productivityRows([item], history(item), day, day, '1.2')
  assert.equal(result.dtf.length, 1)
  assert.equal(result.sublim.length, 0)
  assert.equal(result.press.length, 0)
  assert.equal(summarizeProductivity(result.dtf).productivity, 50)
})

test('Press requires an actual visit; a DTF with recorded Press uses that actual duration', () => {
  const item = order('dtf', { production_type: 'DTF' })
  const events = [
    ...move(item, null, 'design_done', 0), ...move(item, 'design_done', 'printing', 1),
    ...move(item, 'printing', 'press', 3), ...move(item, 'press', 'done', 4),
  ]
  const result = productivityRows([item], events, day, day)
  assert.equal(result.press.length, 1)
  assert.equal(result.press[0].durationMilliseconds, HOUR)
})

test('revisits sum via orderTiming once per SPK and use the latest exit, without clipping to range', () => {
  const item = order()
  const events = [
    ...move(item, null, 'design_done', 0), ...move(item, 'design_done', 'printing', 1),
    ...move(item, 'printing', 'press', 3), ...move(item, 'press', 'printing', 25),
    ...move(item, 'printing', 'press', 28), ...move(item, 'press', 'done', 29),
  ]
  assert.equal(productivityRows([item], events, day, day).sublim.length, 0)
  const result = productivityRows([item], [...events, ...events].reverse(), '2026-09-26', '2026-09-26')
  const timing = orderTiming(item, events, Date.parse(at(30)))
  assert.equal(result.sublim.length, 1)
  assert.equal(result.sublim[0].meter, 100)
  assert.equal(result.sublim[0].durationMilliseconds, 5 * HOUR)
  assert.equal(result.sublim[0].durationMilliseconds, timing.stages.printing.milliseconds)
  assert.equal(result.press[0].durationMilliseconds, timing.stages.press.milliseconds)
})

test('missing history is not fabricated and unrelated branch/order history is ignored', () => {
  const item = order()
  const foreign = order('other-branch')
  const events = history(foreign)
  assert.deepEqual(productivityRows([item], events, day, day), { sublim: [], dtf: [], press: [] })
})

test('archived orders retain completed productivity and non-DTF production types group as Sublim', () => {
  const items = ['Batik', 'Umbul Umbul', 'Lainnya'].map((type, index) => order(String(index), {
    production_type: type, board_stage: 'archive', archive: { archivedAt: at(30) },
  }))
  const result = productivityRows(items, items.flatMap(item => history(item)), day, day)
  assert.equal(result.sublim.length, 3)
  assert.equal(result.press.length, 3)
  assert.equal(result.dtf.length, 0)
})
