import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function compile(file, dependencies = {}) {
  const exports = {}
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', source)(exports, name => dependencies[name])
  return exports
}
const photo = compile('src/lib/order-photo.ts')
const drop = compile('src/lib/order-photo-drop.ts', { './order-photo': photo })
const access = compile('src/lib/access-control.ts')
const image = { type: 'image/jpeg', size: 1024, name: 'photo.jpg' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function harness({ role = 'owner', stage = 'done', busy = false, fail = false } = {}) {
  const state = [], uploads = [], moves = []
  let cursor = 0
  const jsx = (type, props) => ({ type, props })
  const react = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useRef(value) { return state[cursor++] ??= { current: value } },
    useEffect() {}, useMemo(fn) { return fn() },
  }
  const Page = compile('src/app/(dashboard)/schedule/page.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'Link' }, 'lucide-react': {},
    '@/components/production-timers': { OrderTimer: 'OrderTimer' },
    '@/components/stock-shortcuts': { default: 'StockShortcuts' },
    '@/lib/order-photo-drop': drop, '@/lib/access-control': access,
    '@/lib/utils': { formatDueDate: () => 'Hari ini', isOverdue: () => false, cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/production-board': {
      useProductionOrders: () => [{ id: 'order1', spk_code: 'SPK-1', customer: { name: 'Customer' }, production_type: 'DTF', meter: 3, customer_type: 'regular', board_stage: stage }],
      useOnlineConnection: () => ({ profile: { role }, state: 'ready', busy }),
      saveOrderPhoto: async (id, file) => { uploads.push({ id, file }); if (fail) throw new Error('Gagal menyimpan foto') },
      canMoveOrder: () => true,
      moveOrderToStage: async (id, stage) => { moves.push({ id, stage }); return true },
      errorMessage: error => error.message,
    },
  }).default
  const render = () => { cursor = 0; return Page() }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result }
    return null
  }
  const card = () => find(render(), node => node.type === 'article')
  const notice = () => find(render(), node => node.props?.role === 'status')?.props.children
  return { render, find, card, notice, uploads, moves }
}
function event(files = [image], types = ['Files']) {
  return { dataTransfer: { files, types, getData: () => 'order1' }, prevented: false, stopped: false,
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
}

test('file hover works in protected mode; normal card drags are not file uploads', () => {
  assert.equal(drop.isFileDrop({ types: ['Files'] }), true)
  assert.equal(drop.isFileDrop({ types: ['text/plain'] }), false)
  const board = harness(), files = event([])
  board.card().props.onDragOver(files)
  assert.equal(files.dataTransfer.dropEffect, 'copy')
  assert.equal(files.stopped, true)
  assert.match(board.card().props.className, /ring-offset-2/)
  const move = event([], ['text/plain'])
  board.card().props.onDragOver(move)
  board.card().props.onDrop(move)
  assert.equal(move.stopped, false)
  assert.equal(board.uploads.length, 0)
})

test('dropping one image attaches it to the target order without a stage move', async () => {
  const board = harness(), file = event()
  board.card().props.onDrop(file); await tick()
  assert.equal(file.prevented, true); assert.equal(file.stopped, true)
  assert.deepEqual(board.uploads, [{ id: 'order1', file: image }])
  assert.equal(board.moves.length, 0)
  assert.match(board.notice(), /Foto SPK-1 tersimpan/)
})

test('drop validation rejects multiple files, non-images, archived cards, operators and busy state', async () => {
  for (const [options, files] of [[{}, [image, image]], [{}, [{ type: 'application/pdf', size: 100 }]], [{ role: 'operator' }, [image]], [{ stage: 'archive' }, [image]], [{ busy: true }, [image]]]) {
    const board = harness(options), file = event(files)
    board.card().props.onDrop(file); await tick()
    assert.equal(file.prevented, true); assert.equal(file.stopped, true)
    assert.equal(board.uploads.length, 0); assert.equal(board.moves.length, 0)
    assert.ok(board.notice())
  }
})

test('background file drops prevent navigation, while internal card moves still reach the stage handler', async () => {
  const board = harness(), background = event()
  board.render().props.onDrop(background)
  assert.equal(background.prevented, true); assert.equal(board.uploads.length, 0)
  const printing = board.find(board.render(), node => node.props?.['data-board-stage'] === 'printing')
  const target = board.find(printing, node => node.type === 'div' && node.props?.onDrop)
  target.props.onDrop(event([], ['text/plain'])); await tick()
  assert.deepEqual(board.moves, [{ id: 'order1', stage: 'printing' }])
})

test('upload failure is visible and another drop can retry', async () => {
  const board = harness({ fail: true })
  board.card().props.onDrop(event()); await tick()
  assert.equal(board.notice(), 'Gagal menyimpan foto')
  board.card().props.onDrop(event()); await tick()
  assert.equal(board.uploads.length, 2)
})
