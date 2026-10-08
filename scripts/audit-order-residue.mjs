import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { Client } = createRequire(new URL('../.env.reset-tools/package.json', import.meta.url))('pg')
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!process.env.SUPABASE_DB_URL || !apiUrl) throw new Error('Database configuration unavailable')
const connectionUrl = new URL(process.env.SUPABASE_DB_URL)
const project = new URL(apiUrl).hostname.split('.')[0]
if (!(connectionUrl.hostname === `db.${project}.supabase.co` || (connectionUrl.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(connectionUrl.username).endsWith(`.${project}`)))) throw new Error('Database project mismatch')
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: true, ca: readFileSync('.env.reset-tools/supabase-ca.crt', 'utf8') } })
try {
  await db.connect()
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout='30s'")
  const query = async sql => (await db.query(sql)).rows
  const report = {
    checkedAt: new Date().toISOString(),
    orders: await query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE archive_finalized_at IS NULL)::int AS production_board,
      count(*) FILTER (WHERE archive_finalized_at IS NOT NULL)::int AS finalized_archives,
      count(*) FILTER (WHERE source='simulation')::int AS simulation,
      min(order_date)::text AS earliest, max(order_date)::text AS latest FROM orders`),
    stages: await query(`SELECT b.name AS branch, b.is_active AS branch_active, s.code AS stage,
      (o.archive_finalized_at IS NOT NULL) AS finalized, count(*)::int AS orders
      FROM orders o LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN production_steps s ON s.id=o.current_step_id
      GROUP BY 1,2,3,4 ORDER BY 1,3,4`),
    history: await query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE linked.id IS NULL AND identified.id IS NULL)::int AS orphaned,
      count(*) FILTER (WHERE h.order_id IS NULL)::int AS unlinked,
      min(h.occurred_at)::text AS earliest, max(h.occurred_at)::text AS latest
      FROM process_history h LEFT JOIN orders linked ON linked.id=h.order_id
      LEFT JOIN orders identified ON identified.id::text=h.order_identity`),
    orphanGroups: await query(`SELECT h.spk_code, h.order_identity, count(*)::int AS events,
      min(h.occurred_at)::text AS earliest, max(h.occurred_at)::text AS latest
      FROM process_history h LEFT JOIN orders linked ON linked.id=h.order_id
      LEFT JOIN orders identified ON identified.id::text=h.order_identity
      WHERE linked.id IS NULL AND identified.id IS NULL
      GROUP BY 1,2 ORDER BY 4 LIMIT 25`),
    invalidOrders: await query(`SELECT o.id,o.spk_code, CASE WHEN s.id IS NULL THEN 'missing_stage'
      WHEN b.id IS NULL THEN 'missing_branch' WHEN NOT b.is_active THEN 'inactive_branch'
      WHEN c.id IS NULL THEN 'missing_customer' END AS reason
      FROM orders o LEFT JOIN production_steps s ON s.id=o.current_step_id
      LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN customers c ON c.id=o.customer_id
      WHERE s.id IS NULL OR b.id IS NULL OR NOT b.is_active OR c.id IS NULL LIMIT 25`),
    customers: await query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT EXISTS
      (SELECT 1 FROM orders o WHERE o.customer_id=c.id))::int AS without_orders FROM customers c`),
    auxiliaries: {},
  }
  for (const table of ['order_step_events','order_activities','schedule_items','production_schedules','printex_row_changes','order_photo_cleanup']) {
    if ((await db.query('SELECT to_regclass($1) AS name', ['public.'+table])).rows[0].name) {
      report.auxiliaries[table] = (await db.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count
    }
  }
  await db.query('COMMIT')
  mkdirSync('build', { recursive: true })
  writeFileSync('build/order-residue-audit.json', JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(JSON.stringify({ code: error.code ?? 'AUDIT_FAILED', message: /password|postgres(?:ql)?:\/\//i.test(error.message) ? 'Database connection failed' : error.message }))
  process.exitCode = 1
} finally { await db.end() }
