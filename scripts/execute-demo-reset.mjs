// One-off operator tool. Credentials come only from .env.local.
// node --env-file=.env.local scripts/execute-demo-reset.mjs --inspect
// node --env-file=.env.local scripts/execute-demo-reset.mjs --execute
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const taskRequire = createRequire(new URL('../.env.reset-tools/package.json', import.meta.url))
const { Client } = taskRequire('pg')
const url = process.env.SUPABASE_DB_URL
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!url) { console.log('BLOCKED: SUPABASE_DB_URL is not configured.'); process.exit(2) }
const dbUrl = new URL(url)
const projectRef = new URL(apiUrl).hostname.split('.')[0]
if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol)
  || !(dbUrl.hostname === `db.${projectRef}.supabase.co`
    || (dbUrl.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(dbUrl.username).endsWith(`.${projectRef}`)))) {
  throw new Error('Database URL does not match this app Supabase project; refusing reset.')
}
if (!process.argv.includes('--inspect') && !process.argv.includes('--execute') && !process.argv.includes('--cleanup-photos')) throw new Error('Choose --inspect, --execute or --cleanup-photos.')
const db = new Client({ connectionString:url, connectionTimeoutMillis:15000,
  ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../.env.reset-tools/supabase-ca.crt',import.meta.url),'utf8')} })
const api = createClient(apiUrl,process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}})
const protectedTables = ['auth.users','public.profiles','public.branches','public.production_steps','public.machines',
  'public.customer_service_settings','public.stock_shortcuts','public.branch_customer_service_settings','public.branch_stock_shortcuts']
async function protectedSnapshot() {
  const snapshot = {}
  // Compare hashes only: never print/export Auth credentials or user data.
  for (const table of protectedTables) {
    snapshot[table]=(await db.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`)).rows[0].hash
  }
  return snapshot
}
try {
  await db.connect()
  const branches=(await db.query('SELECT id,name,is_active FROM public.branches ORDER BY name')).rows
  const counts=(await db.query(`SELECT (SELECT count(*) FROM public.orders) AS orders,
    (SELECT count(*) FROM public.customers) AS customers,(SELECT count(*) FROM public.process_history) AS history,
    (SELECT count(*) FROM storage.objects WHERE bucket_id='order-photos') AS photos`)).rows[0]
  console.log(JSON.stringify({mode:process.argv.includes('--execute')?'execute':'inspect',branches,counts}))
  if (process.argv.includes('--execute') || process.argv.includes('--cleanup-photos')) {
    const photos=(await db.query("SELECT name FROM storage.objects WHERE bucket_id='order-photos'")).rows.map(r=>r.name)
    if (process.argv.includes('--execute')) {
      const before=await protectedSnapshot()
      const results=await db.query(readFileSync(new URL('../supabase/RESET_DEMO_WEEK.sql',import.meta.url),'utf8'))
      console.log(JSON.stringify({databaseReset:'committed',report:results.at(-1).rows}))
      const after=await protectedSnapshot()
      if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Protected data changed; investigate before further changes.')
      console.log('Accounts, branches, settings, machines and production steps preserved.')
    } else {
      const {rows}=await db.query("SELECT count(*) AS n FROM orders WHERE spk_code LIKE 'DUMMY-%'")
      if (!Number(rows[0].n)) throw new Error('No dummy reset detected; refusing cleanup.')
    }
    let deleted=0
    for (let i=0;i<photos.length;i+=100) {
      const batch=photos.slice(i,i+100)
      // Preserve anything uploaded/reused after reset; delete only old unreferenced files.
      const {rows}=await db.query('SELECT photo_path FROM public.orders WHERE photo_path=ANY($1::text[])',[batch])
      const retained=new Set(rows.map(r=>r.photo_path))
      const paths=batch.filter(path=>!retained.has(path))
      if (!paths.length) continue
      const result=await api.storage.from('order-photos').remove(paths)
      if (result.error) throw new Error(`Photo cleanup failed: ${result.error.message}`)
      await db.query('DELETE FROM public.order_photo_cleanup WHERE path=ANY($1::text[])',[paths])
      deleted+=paths.length
    }
    // Remove stale queue entries only when neither storage nor orders reference them.
    await db.query(`DELETE FROM public.order_photo_cleanup q WHERE NOT EXISTS
      (SELECT 1 FROM storage.objects s WHERE s.bucket_id='order-photos' AND s.name=q.path)
      AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.photo_path=q.path)`)
    const verification=(await db.query(`SELECT count(*) AS orders,
      count(*) FILTER(WHERE spk_code NOT LIKE 'DUMMY-%') AS non_dummy_orders,
      min(order_date) AS first_day,max(order_date) AS last_day FROM public.orders`)).rows[0]
    console.log(JSON.stringify({photosDeleted:deleted,verification,remainingOldPhotos:(await db.query(
      "SELECT count(*) AS n FROM storage.objects WHERE bucket_id='order-photos' AND name=ANY($1::text[])",[photos])).rows[0].n}))
  }
} catch(error) {
  // Connection errors may contain credential-bearing URLs; expose code only.
  console.error(JSON.stringify({errorCode:error.code??'RESET_FAILED',message:
    /password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed; verify local credentials.':error.message}))
  process.exitCode=1
} finally { await db.end().catch(()=>{}) }
