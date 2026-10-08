import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function syncHarness() {
  const source = readFileSync(new URL('../src/lib/production-board.ts', import.meta.url), 'utf8')
  const instrumentation = `
    export function configureTest(fetch: () => Promise<void>) { fetchSnapshot = fetch }
    export function notifyTest() { scheduleRefresh() }
    export function pendingTest() { return fetching }
    export function readTest(request: PromiseLike<unknown>) { return readRequest(request) }
  `
  const compiled = ts.transpileModule(source + instrumentation, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const timers = new Map()
  let nextId = 0
  const exports = {}
  const document = { visibilityState: 'visible' }
  runInNewContext(compiled, {
    exports, require: () => ({jakartaDate: () => '2026-10-01'}), document,
    setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
  })
  return { api: exports, timers, document }
}

test('bulk realtime notifications do not keep an awaited refresh running', async () => {
  const { api, timers } = syncHarness()
  let finish
  let calls = 0
  api.configureTest(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const refresh = api.refreshOnlineData()
  for (let i = 0; i < 1000; i++) api.notifyTest()
  assert.equal(calls, 1)
  assert.equal(timers.size, 0)
  finish()
  await refresh
  assert.equal(calls, 1, 'The original refresh completes before processing more notifications')
  assert.equal(timers.size, 1, 'All notifications become one trailing refresh')
  const callback = [...timers.values()][0]
  timers.clear()
  callback()
  assert.equal(calls, 2)
  finish()
  await api.pendingTest()
})

test('realtime notifications are batched and hidden tabs do not start requests', () => {
  const { api, timers, document } = syncHarness()
  document.visibilityState = 'hidden'
  api.notifyTest()
  assert.equal(timers.size, 0)
  document.visibilityState = 'visible'
  for (let i = 0; i < 1000; i++) api.notifyTest()
  assert.equal(timers.size, 1)
  document.visibilityState = 'hidden'
  assert.doesNotThrow(() => [...timers.values()][0]())
})

test('a stuck read ends with a recoverable timeout and successful reads clear their timers',async()=>{
 const {api,timers}=syncHarness()
 const completed=await api.readTest(Promise.resolve({ok:true}))
 assert.equal(completed.ok,true)
 assert.equal(timers.size,0)
 const stuck=api.readTest(new Promise(()=>{}))
 assert.equal(timers.size,1)
 ;[...timers.values()][0]()
 await assert.rejects(stuck,/melewati batas waktu/)
 assert.equal(timers.size,0)
})
