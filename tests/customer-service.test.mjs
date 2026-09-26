import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function compile(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', source)(name => dependencies[name], exports)
  return exports
}
const phone = compile('src/lib/customer-service.ts')
const access = compile('src/lib/access-control.ts')

test('WhatsApp numbers normalize local and international input without accepting links or script content', () => {
  for (const number of ['0812 3456 7890', '+62 (812) 3456-7890', '6281234567890', '81234567890']) assert.equal(phone.normalizeWhatsAppNumber(number), '6281234567890')
  assert.equal(phone.normalizeWhatsAppNumber('  '), '')
  assert.equal(phone.whatsappUrl('6281234567890'), 'https://wa.me/6281234567890')
  for (const value of ['https://wa.me/6281234567890', 'javascript:alert(1)', '+62abc8123456', '081', '012345678', '1234567890123456', '62+8123456']) assert.throws(() => phone.normalizeWhatsAppNumber(value))
  for (const value of ['', 'javascript:alert(1)', '+6281234567890']) assert.equal(phone.whatsappUrl(value), null)
})

function actions(role, active = true, signedIn = true) {
  let writes = 0
  let saved = ''
  const client = {
    rpc: async () => ({ data: { branches_enabled: false } }),
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'user' } : null } }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role, is_active: active } }) }) }) }
      assert.equal(table, 'customer_service_settings')
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: { whatsapp_number: saved } }) }) }),
        update(value) { writes++; saved = value.whatsapp_number; return { eq: () => ({ select: () => ({ single: async () => ({ data: value }) }) }) } },
      }
    },
  }
  const api = compile('src/app/(dashboard)/settings/customer-service-actions.ts', {
    '@/lib/supabase/server': { createClient: async () => client }, '@/lib/access-control': access, '@/lib/customer-service': phone,
  })
  return { ...api, writes: () => writes }
}

test('server actions allow Admin/Owner writes and deny operator, inactive and unsigned requests', async () => {
  for (const role of ['central_owner', 'owner', 'admin']) {
    const api = actions(role)
    assert.deepEqual(await api.saveCustomerService('081234567890'), { number: '6281234567890', error: '' })
    assert.equal((await api.getCustomerService()).number, '6281234567890')
    assert.equal((await api.saveCustomerService('')).error, '')
    assert.equal(api.writes(), 2)
  }
  for (const api of [actions('operator'), actions('owner', false), actions('admin', true, false), actions('unknown')]) {
    assert.ok((await api.saveCustomerService('081234567890')).error)
    assert.equal(api.writes(), 0)
  }
  const api = actions('admin')
  assert.ok((await api.saveCustomerService('not-a-number')).error)
  assert.equal(api.writes(), 0)
  assert.equal((await actions('operator').getCustomerService()).error, '')
  assert.ok((await actions('operator', false).getCustomerService()).error)
})

test('branch authorization requires an accessible explicit branch and rejects forged branch IDs', async () => {
 const selected='11111111-1111-4111-8111-111111111111'
 let role='central_owner'
 const client={
  auth:{getUser:async()=>({data:{user:{id:'user'}}})},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,is_active:true}})})})}),
  rpc:async(name,args)=>({data:name==='printex_online_status'?{branches_enabled:true}:args.p_branch===selected}),
 }
 const api=compile('src/lib/branch-settings.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/access-control':access})
 await assert.rejects(()=>api.authorizeBranchSettings(null),/Pilih satu cabang/)
 await assert.rejects(()=>api.authorizeBranchSettings('forged'),/Pilih satu cabang/)
 await assert.rejects(()=>api.authorizeBranchSettings('22222222-2222-4222-8222-222222222222'),/akses/)
 assert.equal((await api.authorizeBranchSettings(selected,true)).branchId,selected)
 role='operator'
 assert.equal((await api.authorizeBranchSettings(selected)).branchId,selected)
 await assert.rejects(()=>api.authorizeBranchSettings(selected,true),/Admin dan Owner/)
})
