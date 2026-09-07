import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function advanceToDone(board, orderId) {
  const stages = ['incoming', 'design', 'design_done', 'printing', 'done']
  const current = board.useAllOrders().find(order => order.id === orderId).board_stage
  for (const stage of stages.slice(stages.indexOf(current) + 1)) assert.equal(board.moveOrderToStage(orderId, stage), true)
}

function loadBoard(storage = new Map(), now = '2026-09-07T04:00:00Z') {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return new Date(now).getTime() }
  }
  const cache = {}
  function load(name) {
    if (name === 'react') return { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() }
    if (cache[name]) return cache[name]
    const filename = name.replace('@/lib/', '') + '.ts'
    const compiled = ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const exports = {}
    cache[name] = exports
    runInNewContext(compiled, { exports, require: load, Date: Clock, crypto, Intl, window: {
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      addEventListener() {}, removeEventListener() {},
    } })
    return exports
  }
  return { board: load('@/lib/production-board'), metrics: load('@/lib/process-metrics'), storage }
}

test('one-time reset replaces old local orders and history with ten unique incoming orders today', () => {
  const storage = new Map([['printex-created-orders-v1', '[{"id":"old"}]'], ['printex-process-history-v1', '[{"id":"old-event"}]']])
  const { board, metrics } = loadBoard(storage)
  const orders = board.useBoardOrders()
  assert.equal(orders.length, 10)
  assert.equal(new Set(orders.map(order => order.id)).size, 10)
  assert.equal(new Set(orders.map(order => order.spk_code)).size, 10)
  assert.ok(orders.every(order => order.board_stage === 'incoming' && order.order_date === '2026-09-07' && order.customer.phone === ''))
  assert.equal(metrics.summarizeEvents(board.useProcessHistory(), 'incoming', '2026-09-07', '2026-09-07').entered, 10)
  assert.equal(board.useProcessHistory().length, 10)
  assert.ok([...storage.keys()].some(key => key.endsWith('-backup')))
})

test('unfinished orders retain identity, dates and progress after reload on the next day', () => {
  const { board, storage } = loadBoard()
  const id = board.useBoardOrders()[0].id
  board.moveOrderToStage(id, 'design')
  const tomorrow = loadBoard(storage, '2026-09-08T04:00:00Z').board
  assert.equal(tomorrow.useBoardOrders().length, 10)
  const continued = tomorrow.useBoardOrders().find(order => order.id === id)
  assert.equal(continued.board_stage, 'design')
  assert.equal(continued.order_date, '2026-09-07')
  assert.equal(tomorrow.useProcessHistory().length, 12)
})

test('archiving requires Done and delivery confirmation, and persists without deleting reports', () => {
  const { board, storage, metrics } = loadBoard()
  const order = board.useBoardOrders()[0]
  assert.equal(board.archiveOrder(order.id, 'pickup'), false)
  board.moveOrderToStage(order.id, 'archive')
  assert.equal(board.useBoardOrders()[0].board_stage, 'incoming')
  board.moveOrderToStage(order.id, 'design')
  board.moveOrderToStage(order.id, 'design_done')
  board.moveOrderToStage(order.id, 'printing')
  advanceToDone(board, order.id)
  assert.equal(board.archiveOrder(order.id, 'invalid'), false)
  assert.equal(board.archiveOrder(order.id, 'pickup'), true)
  assert.equal(board.useBoardOrders().length, 9)
  assert.equal(board.useAllOrders().length, 10)
  const archived = board.useAllOrders().find(item => item.id === order.id)
  assert.equal(archived.spk_code, order.spk_code)
  assert.equal(archived.archive.deliveryMethod, 'pickup')
  assert.equal(archived.archive.archivedAt, '2026-09-07T04:00:00.000Z')
  assert.equal(metrics.summarizeEvents(board.useProcessHistory(), 'design', '2026-09-07', '2026-09-07').completed, 1)
  assert.equal(metrics.summarizeEvents(board.useProcessHistory(), 'archive', '2026-09-07', '2026-09-07').entered, 1)
  const length = board.useProcessHistory().length
  assert.equal(board.archiveOrder(order.id, 'delivery'), false)
  board.moveOrderToStage(order.id, 'incoming')
  board.deleteOrder(order.id)
  board.updateOrder(order.id, { spkCode: 'changed' })
  assert.equal(board.useProcessHistory().length, length)
  assert.equal(board.useAllOrders().find(item => item.id === order.id).spk_code, order.spk_code)
  const tomorrow = loadBoard(storage, '2026-09-08T04:00:00Z').board
  assert.equal(tomorrow.useBoardOrders().length, 9)
  assert.equal(tomorrow.useAllOrders().find(item => item.id === order.id).archive.deliveryMethod, 'pickup')
  assert.equal(tomorrow.useProcessHistory().length, length)
})

test('delivery archive records dispatch and ordinary new orders remain possible after reset', () => {
  const { board } = loadBoard()
  board.useBoardOrders()
  const order = board.addOrder({ customerName: 'New Customer', productionType: 'DTF', meter: 10, customerType: 'regular', orderDate: '2026-09-07', dueDate: '2026-09-08', notes: '' })
  assert.equal(board.useBoardOrders().length, 11)
  advanceToDone(board, order.id)
  assert.equal(board.archiveOrder(order.id, 'delivery'), true)
  assert.equal(board.useAllOrders().find(item => item.id === order.id).archive.deliveryMethod, 'delivery')
})

test('archive remains on production board until one-click completion on a later WIB day', () => {
  const { board, storage } = loadBoard()
  const order = board.useBoardOrders()[0]
  assert.equal(board.finishArchivedOrder(order.id), false)
  advanceToDone(board, order.id)
  board.archiveOrder(order.id, 'pickup')
  assert.equal(board.useProductionOrders().length, 10)
  assert.equal(board.useProductionOrders().find(item => item.id === order.id).board_stage, 'archive')
  assert.equal(board.useAllOrders().filter(item => item.archive?.finalizedAt).length, 0)
  const tomorrow = loadBoard(storage, '2026-09-07T17:05:00Z').board
  assert.equal(tomorrow.finishArchivedOrder(order.id), true)
  assert.equal(tomorrow.useProductionOrders().length, 9)
  const saved = tomorrow.useAllOrders().find(item => item.id === order.id)
  assert.equal(saved.archive.archivedAt, '2026-09-07T04:00:00.000Z')
  assert.equal(saved.archive.finalizedAt, '2026-09-07T17:05:00.000Z')
  const later = loadBoard(storage, '2026-09-09T04:00:00Z')
  assert.equal(later.metrics.jakartaDate(saved.archive.finalizedAt), '2026-09-08')
  assert.equal(later.board.finishArchivedOrder(order.id), false)
  assert.equal(later.board.useAllOrders().filter(item => item.archive?.finalizedAt).length, 1)
  assert.equal(later.board.useAllOrders().find(item => item.id === order.id).archive.finalizedAt, saved.archive.finalizedAt)
  assert.equal(later.board.useProductionOrders().length, 9)
  assert.equal(later.board.useProcessHistory().length, board.useProcessHistory().length)
})

test('failed finalization storage leaves the order on the archive board and permits retry', () => {
  const { board, storage } = loadBoard()
  const order = board.useBoardOrders()[0]
  advanceToDone(board, order.id)
  board.archiveOrder(order.id, 'delivery')
  const originalSet = storage.set.bind(storage)
  storage.set = () => { throw new Error('Storage full') }
  assert.throws(() => board.finishArchivedOrder(order.id), /Storage full/)
  assert.equal(board.useProductionOrders().length, 10)
  assert.equal(board.useAllOrders().find(item => item.id === order.id).archive.finalizedAt, undefined)
  storage.set = originalSet
  assert.equal(board.finishArchivedOrder(order.id), true)
  assert.equal(board.useProductionOrders().length, 9)
})

test('reject forward and backward skips without changing order, history or storage', () => {
  const { board, storage } = loadBoard()
  const order = board.useBoardOrders()[0]
  const before = JSON.stringify([...storage])
  for (const target of ['design_done', 'printing', 'done', 'archive', 'invalid']) {
    assert.equal(board.moveOrderToStage(order.id, target), false)
  }
  assert.equal(JSON.stringify([...storage]), before)
  assert.equal(board.useProcessHistory().length, 10)
  advanceToDone(board, order.id)
  const after = JSON.stringify([...storage])
  assert.equal(board.moveOrderToStage(order.id, 'design'), false)
  assert.equal(board.moveOrderToStage(order.id, 'incoming'), false)
  assert.equal(JSON.stringify([...storage]), after)
  for (const stage of ['printing', 'design_done', 'design', 'incoming']) {
    assert.equal(board.moveOrderToStage(order.id, stage), true)
    assert.equal(board.useAllOrders().find(item => item.id === order.id).board_stage, stage)
  }
})

test('sequential movement tracks design and each intermediate process exactly once', () => {
  const { board, metrics } = loadBoard()
  const order = board.useBoardOrders()[0]
  advanceToDone(board, order.id)
  for (const stage of ['design', 'design_done', 'printing']) {
    const report = metrics.summarizeEvents(board.useProcessHistory(), stage, '2026-09-07', '2026-09-07')
    assert.equal(report.entered, 1)
    assert.equal(report.completed, 1)
  }
  const count = board.useProcessHistory().length
  assert.equal(board.moveOrderToStage(order.id, 'done'), false)
  assert.equal(board.useProcessHistory().length, count)
})
