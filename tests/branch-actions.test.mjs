import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'

const id = 'aaaaaaaa-1234-4000-8000-000000000001'
function setup({ role = 'central_owner', active = true, signedIn = true, storageFails = false, authFails = false } = {}) {
  const calls = []
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'actor' } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role, is_active: active } }) }) }) }),
    rpc: async (name, values) => {
      calls.push(values.p_action)
      assert.equal(name, 'printex_manage_branch')
      return { data: values.p_action === 'prepare_delete' ? { photo_paths: Array.from({ length: 205 }, (_, index) => `order/${index}.webp`), user_ids: ['branch-user'] } : [] }
    },
  }
  const admin = {
    storage: { from: bucket => {
      assert.equal(bucket, 'order-photos')
      return { remove: async paths => { calls.push(`files:${paths.length}`); return { error: storageFails ? {} : null } } }
    } },
    auth: { admin: { deleteUser: async user => { assert.equal(user, 'branch-user'); calls.push('auth'); return { error: authFails ? { status: 500 } : null } } } },
  }
  const exports = {}
  const dependencies = { zod: { z }, '@/lib/supabase/server': { createClient: async () => client }, '@/lib/supabase/admin': { createAdminClient: () => admin } }
  const code = ts.transpileModule(readFileSync('src/app/(dashboard)/settings/branch-actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('exports', 'require', code)(exports, key => dependencies[key])
  return { ...exports, calls }
}

test('branch administration rejects lower roles, inactive accounts and unsigned requests before privileged work', async () => {
  for (const options of [{ role: 'owner' }, { role: 'admin' }, { role: 'operator' }, { active: false }, { signedIn: false }]) {
    const api = setup(options)
    assert.ok((await api.listBranches()).error)
    for (const action of ['create', 'rename', 'delete']) assert.ok((await api.saveBranch({ action, id, name: 'Cabang' })).error)
    assert.deepEqual(api.calls, [])
  }
})

test('branch deletion removes every storage batch before Auth and database finalization', async () => {
  const api = setup()
  assert.equal((await api.saveBranch({ action: 'delete', id, name: 'Cabang' })).error, '')
  assert.deepEqual(api.calls, ['prepare_delete', 'files:100', 'files:100', 'files:5', 'auth', 'finish_delete'])
})

test('failed external cleanup never finalizes branch deletion and can be retried', async () => {
  for (const options of [{ storageFails: true }, { authFails: true }]) {
    const api = setup(options)
    assert.match((await api.saveBranch({ action: 'delete', id, name: 'Cabang' })).error, /Lanjutkan Hapus/)
    assert.equal(api.calls.includes('finish_delete'), false)
    if (options.storageFails) assert.equal(api.calls.includes('auth'), false)
  }
})
