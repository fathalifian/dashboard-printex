import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'

function compile(file, dependencies = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('exports', 'require', code)(exports, key => dependencies[key])
  return exports
}
const access = compile('src/lib/access-control.ts')
function setup(role, { duplicate = false, active = true } = {}) {
  let lists = 0
  const profile = { full_name: 'Saya', role, is_active: active, branch_id: role === 'central_owner' ? null : 'branch-a' }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'self', email: 'self@example.com' } } }) },
    from: () => ({ select: () => ({
      data: [{ id: 'other', branch_id: 'branch-a' }, { id: 'self', branch_id: profile.branch_id }],
      eq: () => ({ single: async () => ({ data: profile }) }),
    }) }),
    rpc: async name => {
      if (name === 'printex_online_status') return { data: { schema_version: access.ACCESS_SCHEMA_VERSION, branches_enabled: true } }
      assert.equal(name, 'printex_list_users')
      lists++
      return { data: [{ id: 'other', role: 'operator' }, ...(duplicate ? [{ id: 'self', ...profile }] : [])] }
    },
  }
  return { ...compile('src/app/(dashboard)/settings/users/actions.ts', {
    zod: { z }, '@/lib/access-control': access,
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/supabase/admin': {},
  }), lists: () => lists }
}

test('authorized roles see their own account once, even when the RPC omits it or branch filters exclude it', async () => {
  for (const role of ['central_owner', 'owner', 'admin']) {
    for (const duplicate of [true, false]) {
      const api = setup(role, { duplicate })
      const result = await api.listManagedUsers('branch-b')
      assert.equal(result.error, '')
      assert.equal(result.currentId, 'self')
      assert.deepEqual(result.users.map(user => user.id), ['self'])
      assert.equal(result.users[0].role, role)
      assert.equal(result.users[0].email, 'self@example.com')
      if (!access.canManageUsers(role)) assert.equal(api.lists(), 0)
    }
  }
})

test('operators cannot list managed accounts, including through a direct server action', async () => {
  for (const role of ['operator', 'staff']) {
    const api = setup(role)
    const result = await api.listManagedUsers('branch-a')
    assert.ok(result.error)
    assert.deepEqual(result.users, [])
    assert.equal(api.lists(), 0)
  }
})

test('self listing does not grant management permissions and inactive accounts cannot list', async () => {
  for (const role of ['admin', 'operator']) {
    const api = setup(role)
    assert.ok((await api.addManagedUser({})).error)
    assert.ok((await api.updateManagedUser('other', {})).error)
    assert.ok((await api.deleteManagedUser('other')).error)
    assert.equal(api.lists(), 0)
  }
  const result = await setup('owner', { active: false }).listManagedUsers()
  assert.ok(result.error)
  assert.deepEqual(result.users, [])
})
