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
const shortcuts = compile('src/lib/stock-shortcuts.ts')
const access = compile('src/lib/access-control.ts')
const input = { ...shortcuts.DEFAULT_STOCK_SHORTCUTS[0], label: '  Stok DTF baru  ', url: 'https://docs.google.com/spreadsheets/d/new/edit#gid=123' }

test('shortcut validation accepts full HTTPS links and rejects unsafe schemes, credentials and invalid fields', () => {
  assert.equal(shortcuts.validateStockShortcut(input).label, 'Stok DTF baru')
  assert.equal(shortcuts.validateStockShortcut(input).url, input.url)
  for (const bad of [{ label: '' }, { label: 'x'.repeat(61) }, { url: 'javascript:alert(1)' }, { url: 'data:text/html,hello' }, { url: 'http://example.com' }, { url: 'https://user:secret@example.com' }, { url: '//example.com' }, { url: 'https://example.com/a b' }, { id: 'unknown' }, { version: 0 }, { version: 1.5 }]) {
    assert.throws(() => shortcuts.validateStockShortcut({ ...input, ...bad }))
  }
})

function actions(role, { active = true, signedIn = true, conflict = false } = {}) {
  let saved = structuredClone(shortcuts.DEFAULT_STOCK_SHORTCUTS)
  let writes = 0
  const client = {
    rpc: async () => ({ data: { branches_enabled: false } }),
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'user' } : null } }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role, is_active: active } }) }) }) }
      assert.equal(table, 'stock_shortcuts')
      return {
        select: () => ({ order: async () => ({ data: saved }), eq: (_, id) => ({ maybeSingle: async () => ({ data: saved.find(row => row.id === id) }) }) }),
        update(value) {
          writes++
          const filters = {}
          const query = { eq(key, val) { filters[key] = val; return query }, select() { return query }, async maybeSingle() {
            if (conflict) return { data: null }
            const row = saved.find(row => row.id === filters.id && row.version === filters.version)
            if (!row) return { data: null }
            saved = saved.map(item => item.id === row.id ? { ...item, ...value } : item)
            return { data: saved.find(item => item.id === row.id) }
          } }
          return query
        },
      }
    },
  }
  return { ...compile('src/app/(dashboard)/schedule/shortcut-actions.ts', { '@/lib/branch-settings': compile('src/lib/branch-settings.ts', { '@/lib/supabase/server': { createClient: async () => client }, '@/lib/access-control': access }), '@/lib/stock-shortcuts': shortcuts }), writes: () => writes }
}

test('active Owner and Admin can persist names and links; Operator can only read', async () => {
  for (const role of ['central_owner', 'owner', 'admin']) {
    const api = actions(role)
    const result = await api.saveStockShortcut(input)
    assert.equal(result.error, '')
    assert.equal(result.shortcut.version, 2)
    assert.equal((await api.getStockShortcuts()).shortcuts[0].label, 'Stok DTF baru')
  }
  for (const role of ['operator']) {
    const api = actions(role)
    assert.equal((await api.getStockShortcuts()).error, '')
    assert.match((await api.saveStockShortcut(input)).error, /Admin/)
    assert.equal(api.writes(), 0)
  }
  for (const api of [actions('owner', { active: false }), actions('owner', { signedIn: false }), actions('admin', { active: false }), actions('admin', { signedIn: false }), actions('unknown')]) {
    assert.ok((await api.getStockShortcuts()).error)
    assert.ok((await api.saveStockShortcut(input)).error)
    assert.equal(api.writes(), 0)
  }
})

test('invalid inputs and concurrent edits cannot silently overwrite saved shortcuts', async () => {
  const admin = actions('admin')
  assert.ok((await admin.saveStockShortcut({ ...input, url: 'javascript:alert(1)' })).error)
  assert.equal(admin.writes(), 0)
  assert.match((await actions('admin', { conflict: true }).saveStockShortcut(input)).error, /diubah/)
})

test('all roles get arrow-free links; Owner and Admin see edit buttons', () => {
  const jsx = (type, props) => ({ type, props })
  function all(node, predicate) {
    if (!node || typeof node !== 'object') return []
    return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => all(child, predicate))]
  }
  for (const role of ['owner', 'admin', 'operator']) {
    const { default: Shortcuts } = compile('src/components/stock-shortcuts.tsx', {
      react: { useState: value => [Array.isArray(value) ? shortcuts.DEFAULT_STOCK_SHORTCUTS : value, () => {}], useRef: value => ({ current: value }), useEffect() {} },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Sheet: 'Sheet', Pencil: 'Pencil', X: 'X' },
      '@/lib/production-board': { useOnlineConnection: () => ({ profile: { id: 'user', role } }) },
      '@/lib/access-control': access, '@/lib/stock-shortcuts': shortcuts,
      '@/app/(dashboard)/schedule/shortcut-actions': {},
    })
    const tree = Shortcuts()
    const links = all(tree, node => node.type === 'a')
    assert.equal(links.length, 2)
    assert.ok(links.every(link => link.props.target === '_blank' && link.props.rel.includes('noopener')))
    assert.equal(all(tree, node => node.type === 'button').length, role === 'admin' || role === 'owner' ? 2 : 0)
    assert.equal(all(tree, node => node.type === 'ExternalLink').length, 0)
  }
})

test('stock loads through one branch-filtered read without server action requests', async () => {
  const effects = []
  const reads = []
  const updates = []
  let queries = 0
  const branchId = '22222222-2222-4222-8222-222222222222'
  const previousWindow = globalThis.window
  globalThis.window = { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} }
  try {
    const { default: Shortcuts } = compile('src/components/stock-shortcuts.tsx', {
      react: { useState: value => [value, value => updates.push(value)], useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
      'lucide-react': {},
      '@/lib/production-board': { useOnlineConnection: () => ({ profile: { id: 'user', role: 'owner' }, branchId, branches: [{ id: branchId }] }) },
      '@/lib/access-control': access, '@/lib/stock-shortcuts': shortcuts,
      '@/app/(dashboard)/schedule/shortcut-actions': {},
      '@/lib/supabase/client': { createClient: () => ({ from(table) {
        reads.push(table)
        const query = { select: () => query, eq: (key, value) => { reads.push([key, value]); return query }, order: async () => { queries++; return { data: shortcuts.DEFAULT_STOCK_SHORTCUTS } } }
        return query
      } }) },
    })
    Shortcuts()
    const cleanup = effects[0]()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(queries, 1)
    assert.deepEqual(reads, ['branch_stock_shortcuts', ['branch_id', branchId]])
    assert.ok(updates.includes(true))
    cleanup()
  } finally { globalThis.window = previousWindow }
})
