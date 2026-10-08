// Installs a read-only RPC and indexes. Business rows must remain byte-for-byte unchanged.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required')
const { Client } = createRequire(new URL('../.env.reset-tools/package.json', import.meta.url))('pg')
const databaseUrl = new URL(process.env.SUPABASE_DB_URL)
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if (!(databaseUrl.hostname === `db.${project}.supabase.co` || (databaseUrl.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(databaseUrl.username).endsWith(`.${project}`)))) throw new Error('Database project mismatch')
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: true, ca: readFileSync('.env.reset-tools/supabase-ca.crt', 'utf8') } })
const directory = `build/backups/scoped-loading-${new Date().toISOString().replace(/[:.]/g,'-')}`
const tables = ['orders','customers','process_history','profiles','branches','production_steps']
async function fingerprints() {
  const result = {}
  for (const table of tables) result[table] = (await db.query(`SELECT count(*)::int AS count,
    md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM public.${table} t`)).rows[0]
  return result
}
let committed = false
try {
  await db.connect()
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'")
  const before = await fingerprints()
  const previous = (await db.query(`SELECT pg_get_functiondef(oid) AS definition FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('printex_scoped_snapshot','printex_read_branches')`)).rows
  const policies = (await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('orders','customers','process_history','branches')")).rows
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${directory}/before.json`, JSON.stringify({before,previous,policies}, null, 2), { mode:0o600 })
  const files = ['0025_scoped_snapshot.sql']
  if (process.argv.includes('--include-access-cache')) files.push('0026_cached_branch_reads.sql')
  for (const file of files) {
    const migration = readFileSync('supabase/migrations/'+file,'utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
    await db.query(migration)
  }
  const after = await fingerprints()
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Business rows changed; refusing commit')
  await db.query("NOTIFY pgrst, 'reload schema'")
  await db.query('COMMIT'); committed = true
  writeFileSync(`${directory}/after.json`, JSON.stringify(after,null,2), { mode:0o600 })
  console.log(JSON.stringify({committed,businessDataPreserved:true,backup:directory,counts:Object.fromEntries(tables.map(table=>[table,after[table].count]))}))
} catch (error) {
  if (!committed) await db.query('ROLLBACK').catch(()=>{})
  console.error(JSON.stringify({committed,code:error.code??'ACTIVATION_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Database connection failed':error.message}))
  process.exitCode=1
} finally { await db.end() }
