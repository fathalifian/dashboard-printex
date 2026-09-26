import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const accounts = JSON.parse(readFileSync('.env.official-accounts.json', 'utf8'))
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const client = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const branches = await client.from('branches').select('id,name')
if (branches.error) throw new Error(branches.error.message)
const users = []
for (let page = 1; ; page++) {
  const result = await client.auth.admin.listUsers({ page, perPage: 100 })
  if (result.error) throw new Error(result.error.message)
  users.push(...result.data.users)
  if (result.data.users.length < 100) break
}
for (const account of accounts) {
  const branch = branches.data.find(branch => branch.name === account.branch)
  if (account.role !== 'central_owner' && !branch) throw new Error('Cabang tidak ditemukan: ' + account.branch)
  const existing = users.find(user => user.email?.toLowerCase() === account.email.toLowerCase())
  const credentials = { password: account.password, email_confirm: true, user_metadata: { full_name: account.name } }
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, credentials)
    : await client.auth.admin.createUser({ ...credentials, email: account.email })
  if (result.error || !result.data.user) throw new Error(result.error?.message || 'Akun gagal dibuat.')
  const profile = await client.from('profiles').update({ full_name: account.name, role: account.role, branch_id: branch?.id ?? null, is_active: true })
    .eq('id', result.data.user.id).select('id,role,branch_id,is_active').single()
  if (profile.error) throw new Error(profile.error.message)
  const login = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await login.auth.signInWithPassword({ email: account.email, password: account.password })
  if (signed.error) throw new Error(signed.error.message)
  const context = await login.rpc('printex_branch_context')
  if (context.error) throw new Error(context.error.message)
  if (account.role === 'central_owner' ? !context.data.central : context.data.branches.length !== 1 || context.data.branches[0].id !== branch.id) throw new Error('Hak cabang tidak sesuai.')
  console.log(JSON.stringify({ email: account.email, role: account.role, branch: account.branch || 'Semua cabang', existing: !!existing, active: profile.data.is_active, loginVerified: true }))
  await login.auth.signOut({ scope: 'local' })
}
