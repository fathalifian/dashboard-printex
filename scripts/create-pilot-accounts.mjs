import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Konfigurasi Supabase server belum lengkap.')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const file = '.env.pilot-accounts.json' // Ignored by Git; never import into browser code.
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { project: new URL(url).hostname, accounts: [] }
if (saved.project !== new URL(url).hostname) throw new Error('File akun berasal dari proyek berbeda.')
const definitions = [
  { email: 'owner.pusat@printex.test', name: 'Owner Pusat Uji Coba', role: 'central_owner', branch: null },
  { email: 'admin.salatiga@printex.test', name: 'Admin Salatiga Uji Coba', role: 'admin', branch: 'Salatiga' },
  { email: 'admin.semarang@printex.test', name: 'Admin Semarang Uji Coba', role: 'admin', branch: 'Semarang' },
]
for (const definition of definitions) {
  if (saved.accounts.some(account => account.email === definition.email)) continue
  const password = randomBytes(24).toString('base64url')
  const result = await client.auth.admin.createUser({ email: definition.email, password, email_confirm: true, user_metadata: { full_name: definition.name } })
  if (result.error || !result.data.user) throw new Error(result.error?.message || 'Pembuatan akun gagal.')
  // Persist recovery information before any subsequent network call.
  saved.accounts.push({ ...definition, id: result.data.user.id, password })
  writeFileSync(file, JSON.stringify(saved, null, 2))
  const disabled = await client.from('profiles').update({ is_active: false }).eq('id', result.data.user.id)
  if (disabled.error) throw new Error('Akun dibuat, tetapi status profil perlu diperiksa: ' + disabled.error.message)
}
console.log(JSON.stringify({ accounts: saved.accounts.map(({ email, id }) => ({ email, id })), credentialsFile: file }))
