import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'

function setup({ signedIn = true, active = true } = {}) {
  const writes = []
  const dependencies = {
    zod: { z },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'self' } : null } }) } }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from(table) {
      assert.equal(table, 'profiles')
      return { update(values) {
        const filters = {}
        const query = {
          eq(key, value) { filters[key] = value; return query },
          select() { return query },
          async single() {
            assert.deepEqual(filters, { id: 'self', is_active: true })
            if (!active) return { error: new Error('No active profile') }
            writes.push(values)
            return { data: { id: 'self' }, error: null }
          },
        }
        return query
      } }
    } }) },
  }
  const exports = {}
  const source = ts.transpileModule(readFileSync('src/components/layout/account-actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('exports', 'require', source)(exports, name => dependencies[name])
  return { ...exports, writes }
}

test('self account edits ignore forged identity and permissions and only persist a trimmed name', async () => {
  const api = setup()
  assert.equal((await api.updateOwnAccount({ fullName: '  Nama Baru  ', id: 'other', role: 'central_owner', is_active: false, branch_id: 'other' })).error, '')
  assert.equal(api.writes.length, 1)
  assert.equal(api.writes[0].full_name, 'Nama Baru')
  assert.deepEqual(Object.keys(api.writes[0]).sort(), ['full_name', 'updated_at'])
})

test('self account edits reject anonymous, inactive and invalid requests', async () => {
  for (const options of [{ signedIn: false }, { active: false }]) {
    const api = setup(options)
    assert.ok((await api.updateOwnAccount({ fullName: 'Nama' })).error)
    assert.equal(api.writes.length, 0)
  }
  const api = setup()
  for (const fullName of ['', '   ', 'x'.repeat(101), null]) assert.ok((await api.updateOwnAccount({ fullName })).error)
  assert.equal(api.writes.length, 0)
})
