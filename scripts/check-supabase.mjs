import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) { console.error('Missing Supabase URL or public key'); process.exit(1) }
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
console.log('Project host:', new URL(url).hostname)
for (const [table, select] of [
  ['production_steps', 'id,code,sequence'], ['orders', 'id,archived_at,archive_finalized_at,delivery_method'],
  ['customers', 'id'], ['profiles', 'id'], ['process_history', 'id,order_identity'],
]) {
  const { error, count } = await client.from(table).select(select, { head: true, count: 'exact' })
  console.log(JSON.stringify({ table, accessible: !error, count, error: error ? { code: error.code, message: error.message } : null }))
}
const { data, error } = await client.from('production_steps').select('code,sequence').order('sequence')
console.log('Stages:', error ? error.code : data)
for (const path of ['/rest/v1/', '/rest/v1/process_history?select=id&limit=0', '/auth/v1/settings']) {
  try {
    const response = await fetch(url + path, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) })
    const body = await response.json()
    if (path === '/rest/v1/') console.log('Exposed schema:', Object.fromEntries(Object.entries(body.definitions ?? {}).map(([table, schema]) => [table, Object.keys(schema.properties ?? {})])))
    else console.log('Endpoint:', path, 'status:', response.status, 'details:', path.startsWith('/auth') ? { signupDisabled: body.disable_signup, emailEnabled: body.external?.email } : body)
  } catch { console.log('Endpoint unavailable:', path) }
}
