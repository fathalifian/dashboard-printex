import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function compile(file, dependencies = {}, globals = {}) {
  const exports = {}
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(source, { exports, require: name => dependencies[name] ?? require(name), Buffer, Date, JSON, Error, URL, AbortSignal, fetch, process, ...globals })
  return exports
}
const { reportRequestSchema } = compile('src/lib/report-request.ts')
const request = (extra = {}) => reportRequestSchema.parse({ rpc: 'printex_daily_report', args: { p_start: '2026-09-01', p_end: '2026-09-30' }, ...extra })
const cacheModule = compile('src/lib/server/report-cache.ts')

test('report API accepts only bounded, real dates and allowlisted RPC/filter parameters', () => {
  assert.equal(request().args.p_limit, 50)
  for (const input of [
    { rpc: 'printex_mutate_order' },
    { args: { p_start: '2026-02-30', p_end: '2026-03-01' } },
    { args: { p_start: '2025-01-01', p_end: '2026-01-02' } },
    { args: { p_start: '2026-09-02', p_end: '2026-09-01' } },
    { rpc: 'printex_report_details' },
    { args: { ...request().args, p_limit: 201 } },
    { args: { ...request().args, p_branch: 'not-a-uuid' } },
    { args: { ...request().args, p_search: 'x'.repeat(201) } },
    { args: { ...request().args, injected: true } },
  ]) assert.throws(() => request(input))
})

test('report cache coalesces requests, expires, bypasses and bounds entries and bytes', async () => {
  let now = 0, reads = 0
  const cache = cacheModule.createReportCache({ now: () => now, maxBytes: 12, maxEntries: 2, ttl: 10 })
  const load = async () => { reads++; return '1234' }
  const valid = () => true
  const [first, second] = await Promise.all([cache.read('a', load, valid), cache.read('a', load, valid)])
  assert.equal(reads, 1); assert.equal(first.source, 'database'); assert.equal(second.source, 'coalesced')
  assert.equal((await cache.read('a', load, valid)).source, 'memory')
  await cache.read('a', load, valid, true); assert.equal(reads, 2)
  now = 11; await cache.read('a', load, valid); assert.equal(reads, 3)
  await cache.read('b', load, valid); await cache.read('c', load, valid)
  await cache.read('a', load, valid); assert.equal(reads, 6)
  await cache.read('large', async () => 'x'.repeat(13), valid)
  assert.equal((await cache.read('large', load, valid)).source, 'database')
  await assert.rejects(cache.read('failed', async () => { throw Error('failed') }, valid))
  assert.equal((await cache.read('failed', load, valid)).source, 'database')
  await cache.read('partial', load, () => false)
  assert.equal((await cache.read('partial', load, valid)).source, 'database')
})

test('an older in-flight report cannot replace the result of a forced refresh', async () => {
  const cache = cacheModule.createReportCache()
  let resolve
  const old = cache.read('key', () => new Promise(done => { resolve = done }), () => true)
  await cache.read('key', async () => 'fresh', () => true, true)
  resolve('old'); await old
  assert.equal((await cache.read('key', async () => 'unexpected', () => true)).value, 'fresh')
})

test('optional Redis failures fall back and activate a short circuit breaker', async () => {
  let calls = 0
  const redis = compile('src/lib/server/report-cache.ts', {}, {
    process: { env: { UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test' } },
    fetch: async () => { calls++; throw Error('offline') },
  })
  assert.equal(await redis.redisCommand(['GET', 'key']), null)
  assert.equal(await redis.redisCommand(['GET', 'key']), null)
  assert.equal(calls, 1)
})

function service() {
  const branch = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const state = { user: 'owner-a', role: 'owner', active: true, branches: [branch], reads: 0, pending: false }
  const client = {
    auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: state.role, is_active: state.active } }) }) }) }),
    rpc(name) {
      const data = name === 'printex_branch_context' ? { branches: state.branches.map(id => ({ id })), central: false } :
        (state.reads++, { rows: [{ branchId: state.branches[0], count: state.reads }], pending: state.pending, asOf: new Date().toISOString() })
      return { abortSignal: async () => ({ data }) }
    },
  }
  const api = compile('src/lib/server/report-service.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/access-control': compile('src/lib/access-control.ts'),
    './report-cache': { createReportCache: cacheModule.createReportCache, createQueryGate: cacheModule.createQueryGate, redisCommand: async () => null },
  })
  return { api, state, branch, other }
}

test('cached reports recheck identity, account activity, role and branch membership', async () => {
  const { api, state, branch, other } = service()
  const input = request({ args: { ...request().args, p_branch: branch } })
  await api.readReport(input); await api.readReport(input); assert.equal(state.reads, 1)
  state.active = false; await assert.rejects(api.readReport(input), error => error.status === 403)
  state.active = true; state.branches = [other]; await assert.rejects(api.readReport(input), error => error.status === 403)
  state.branches = [branch]; state.user = 'owner-b'; await api.readReport(input); assert.equal(state.reads, 2)
  state.user = null; await assert.rejects(api.readReport(input), error => error.status === 401)
})

test('operator summary reads work but detail requests are forbidden; pending results are never cached', async () => {
  const { api, state } = service()
  state.role = 'operator'; state.pending = true
  await api.readReport(request()); await api.readReport(request()); assert.equal(state.reads, 2)
  state.pending = false; await api.readReport(request()); await api.readReport(request()); assert.equal(state.reads, 3)
  await api.readReport(request({ bypassCache: true })); assert.equal(state.reads, 4)
  const details = request({ rpc: 'printex_report_details', args: { ...request().args, p_metric: 'archive' } })
  await assert.rejects(api.readReport(details), error => error.status === 403)
  state.role = 'admin'; await api.readReport(details); await api.readReport(details); assert.equal(state.reads, 6)
})

test('report transport handles session redirects and passes refresh bypass explicitly', async () => {
  let captured
  const client = compile('src/lib/report-client.ts', {}, { fetch: async (_, options) => {
    captured = JSON.parse(options.body)
    return { redirected: false, ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ rows: [] }) }
  } })
  await client.requestReport('printex_daily_report', request().args, true)
  assert.equal(captured.bypassCache, true)
  const expired = compile('src/lib/report-client.ts', {}, { fetch: async () => ({ redirected: true }) })
  await assert.rejects(expired.requestReport('printex_daily_report', request().args), /login/)
})

test('query admission bounds database work and releases slots after failure', async () => {
  const gate = cacheModule.createQueryGate(1)
  let resolve
  const active = gate(() => new Promise(done => { resolve = done }), () => Error('busy'))
  await assert.rejects(gate(async () => 'extra', () => Error('busy')), /busy/)
  resolve('done'); await active
  await assert.rejects(gate(async () => { throw Error('database failed') }, () => Error('busy')), /database failed/)
  assert.equal(await gate(async () => 'recovered', () => Error('busy')), 'recovered')
})
