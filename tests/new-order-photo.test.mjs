import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Exercise form submissions across rerenders with network outcomes under our control.
function pageHarness({ failPhoto = false } = {}) {
  const values = [], calls = { created: [], uploaded: [], routes: [] }
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      return values[index] ??= { current: initial }
    },
  }
  const jsx = (type, props) => ({ type, props })
  const dependencies = {
    react,
    '@/components/order-photo-input': { OrderPhotoInput: 'PhotoInput' },
    '@/lib/order-photo': { compressOrderPhoto: async file => ({ ...file, type: 'image/webp' }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'Link' },
    'next/navigation': { useRouter: () => ({ replace: route => calls.routes.push(route) }) },
    '@/lib/process-metrics': { jakartaDate: () => '2026-09-25' },
    '@/lib/production-board': {
      addOrder: async (input, id) => { calls.created.push({ input, id }) },
      saveOrderPhoto: async (id, file) => {
        calls.uploaded.push({ id, file })
        if (failPhoto) { failPhoto = false; throw new Error('Upload gagal') }
      },
      errorMessage: error => error.message,
    },
  }
  const source = ts.transpileModule(readFileSync('src/app/(dashboard)/orders/new/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'require', source)(exports, name => dependencies[name])
  const render = () => { cursor = 0; return exports.default() }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) {
      const match = find(child, predicate)
      if (match) return match
    }
    return null
  }
  const submit = () => find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  return { calls, render, find, submit }
}

test('order without optional photo saves normally without a storage request', async () => {
  const page = pageHarness()
  await page.submit()
  assert.equal(page.calls.created.length, 1)
  assert.equal(page.calls.uploaded.length, 0)
  assert.deepEqual(page.calls.routes, ['/schedule'])
})

test('rapid double submission does not duplicate creation or upload', async () => {
  const page = pageHarness()
  await Promise.all([page.submit(), page.submit()])
  assert.equal(page.calls.created.length, 1)
  assert.equal(page.calls.uploaded.length, 0)
})


test('optional photo uploads after creation and is compressed', async () => {
  const page = pageHarness()
  page.find(page.render(), node => node.type === 'PhotoInput').props.onChange({name:'order.png',type:'image/png'})
  await page.submit()
  assert.equal(page.calls.created.length, 1)
  assert.equal(page.calls.uploaded.length, 1)
  assert.equal(page.calls.uploaded[0].id, page.calls.created[0].id)
  assert.equal(page.calls.uploaded[0].file.type, 'image/webp')
  assert.deepEqual(page.calls.routes, ['/schedule'])
})

test('photo retry does not create a second order after upload failure', async () => {
  const page = pageHarness({failPhoto:true})
  page.find(page.render(), node => node.type === 'PhotoInput').props.onChange({name:'order.png',type:'image/png'})
  await page.submit()
  assert.equal(page.calls.routes.length, 0)
  assert.match(page.find(page.render(), node => node.props?.role === 'alert').props.children, /Order sudah tersimpan/)
  await page.submit()
  assert.equal(page.calls.created.length, 1)
  assert.equal(page.calls.uploaded.length, 2)
  assert.deepEqual(page.calls.routes, ['/schedule'])
})
