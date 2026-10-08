import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function compile(path, resolve = require) {
  const exports = {}
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  new Function('exports', 'require', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText)(exports, resolve)
  return exports
}
const metrics = compile('../src/lib/process-metrics.ts')
const branches = [{ id: 'a', name: 'Demak' }, { id: 'b', name: 'Salatiga' }]
const at = '2026-10-01T05:00:00Z'
const orders = branches.map((branch, i) => ({ id: branch.id, branch_id: branch.id, spk_code: branch.id, customer: { name: branch.name }, board_stage: 'archive', order_date: '2026-10-01', meter: (i + 1) * 100, archive: { finalizedAt: at, deliveryMethod: i ? 'delivery' : 'pickup' } }))
function render(kind, status = {}) {
  const board = {
    useOnlineConnection: () => ({ state: 'ready', central: true, branchId: null, branches, ...status }),
    useAllOrders: () => orders,
    useProcessHistory: () => branches.map(branch => ({ id: branch.id, orderId: branch.id, branchId: branch.id, stage: 'printing', kind: 'completed', occurredAt: at })),
    BOARD_STAGE_META: Object.fromEntries(metrics.PROCESS_STAGES.map(stage => [stage, { name: stage }])),
  }
  const Component = compile('../src/components/report-rooms.tsx', name => {
    if (name === '@/components/report-status') return {__esModule:true,default:()=>null}
    if (name === '@/lib/report-summaries') return {useDailySummary:()=>({enabled:false,loading:false,error:'',rows:[]})}
    if (name === '@/lib/production-board') return board
    if (name === '@/lib/process-metrics') return metrics
    if (name === '@/lib/room-navigation') return compile('../src/lib/room-navigation.ts')
    if (name === '@/components/date-range-filter') return { __esModule: true, default: () => null }
    return require(name)
  }).default
  return renderToStaticMarkup(React.createElement(Component, { kind, range: { period: 'custom', start: '2026-10-01', end: '2026-10-01' }, onRangeChange: () => {} }, 'DETAIL_REPORT'))
}
test('archive rooms show combined totals and isolated branch totals', () => {
  const sections = render('archive').match(/<section\b[\s\S]*?<\/section>/g)
  assert.equal(sections.length, 3)
  assert.match(sections[0], /Semua cabang/)
  assert.match(sections[0], /300 m/)
  assert.match(sections[1], /Demak/)
  assert.match(sections[1], /100 m/)
  assert.doesNotMatch(sections[1], /300 m|200 m/)
  assert.match(sections[2], /Salatiga/)
  assert.match(sections[2], /200 m/)
})
test('process rooms aggregate completion events without mixing branches', () => {
  const sections = render('process').match(/<section\b[\s\S]*?<\/section>/g)
  const printing = section => section.match(/data-board-stage="printing"[\s\S]*?<\/dl>/)[0]
  assert.match(printing(sections[0]), />2<\/dd>/)
  assert.match(printing(sections[1]), />1<\/dd>/)
  assert.match(printing(sections[2]), />1<\/dd>/)
})
test('selected branch shows detail and branch accounts have no combined room', () => {
  assert.match(render('process', { branchId: 'a' }), /DETAIL_REPORT/)
  const branch = render('archive', { central: false, branchId: 'a', branches: [branches[0]] })
  assert.match(branch, /DETAIL_REPORT/)
  assert.doesNotMatch(branch, /Semua cabang|Semua ruang laporan/)
})
test('loading and errors never present incomplete reports as zero counts', () => {
  assert.match(render('process', { state: 'loading' }), /Memuat ruang laporan/)
  const error = render('archive', { state: 'error', error: 'Koneksi terputus' })
  assert.match(error, /Koneksi terputus/)
  assert.doesNotMatch(error, /DETAIL_REPORT|Buka laporan/)
})
