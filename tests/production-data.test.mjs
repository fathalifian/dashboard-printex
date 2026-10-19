import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test, after } from 'node:test'

// The bundled setup on an empty database, as in the Supabase SQL Editor.
const db = new PGlite()
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,created_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;`)
await db.exec(readFileSync('supabase/SETUP.sql', 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, ''))

const owner = '00000000-0000-4000-8000-0000000000a1', operator = '00000000-0000-4000-8000-0000000000a2'
await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'owner@example.test'),($2,'operator@example.test')`, [owner, operator])
await db.query(`UPDATE profiles SET role='owner',is_active=true WHERE id=$1`, [owner])
await db.query(`UPDATE profiles SET role='operator',is_active=true WHERE id=$1`, [operator])
const as = async user => { await db.exec('RESET ROLE'); await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [user]); await db.exec('SET ROLE authenticated') }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const today = (await one(`SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS d`)).d
const machine = async name => (await one('SELECT id FROM production_machines WHERE name=$1', [name])).id
const version = async id => (await one('SELECT version FROM orders WHERE id=$1', [id])).version
async function create(id, productionType, meter) {
  await db.query('SELECT printex_mutate_order($1,$2,NULL,$3)', ['create', id, { customerName: 'Customer ' + id.slice(-2), productionType, meter, customerType: 'regular', orderDate: today, dueDate: today, notes: '', spkCode: 'T-' + id.slice(-4) }])
}
async function move(id, code) {
  await db.query('SELECT printex_mutate_order($1,$2,$3,$4)', ['move', id, await version(id), { code }])
}
async function toPrinting(id, machineName) {
  await move(id, 'DESIGN_DONE')
  await db.query('SELECT printex_set_print_machine($1,$2,$3,true)', [id, await version(id), await machine(machineName)])
}

test('setup seeds one location: four machines, standard working time and crew, no branch columns', async () => {
  await as(owner)
  assert.deepEqual((await db.query('SELECT kind,name FROM production_machines ORDER BY name')).rows.map(row => row.name), ['DTF 1', 'Fedar 1', 'Fedar 2', 'Press 1'])
  assert.deepEqual(await one('SELECT shifts,shift_hours::float,planned_downtime_minutes,effective_hours::float,operators_printing,operators_dtf,operators_press,operators_design FROM production_settings'),
    { shifts: 1, shift_hours: 9, planned_downtime_minutes: 120, effective_hours: 7, operators_printing: 2, operators_dtf: 1, operators_press: 3, operators_design: 1 })
  await db.exec('RESET ROLE')
  assert.equal((await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND column_name='branch_id'`)).n, 0)
  assert.equal(await one(`SELECT to_regclass('public.branches') AS t`).then(row => row.t), null)
  await as(owner)
  const status = (await one('SELECT printex_online_status() AS s')).s
  assert.equal(status.schema_version, 9)
  assert.equal(status.daily_summaries_enabled, true)
})

test('working time recomputes effective hours; only owner/admin change settings and machines', async () => {
  await as(owner)
  await db.query('UPDATE production_settings SET shift_hours=8.5, planned_downtime_minutes=90, version=version+1')
  assert.equal((await one('SELECT effective_hours::float AS h FROM production_settings')).h, 7)
  await assert.rejects(db.query('UPDATE production_settings SET shifts=3, shift_hours=9'), /maksimal 24 jam/)
  await db.query('UPDATE production_settings SET shift_hours=9, planned_downtime_minutes=120')
  await db.query(`INSERT INTO production_machines(kind,name) VALUES('fedar','Fedar 3')`)
  await assert.rejects(db.query(`INSERT INTO production_machines(kind,name) VALUES('fedar','fedar 3')`), /duplicate|unique/i)
  await db.query(`UPDATE production_machines SET removed_at=now() WHERE name='Fedar 3'`)
  await as(operator)
  await db.query('UPDATE production_settings SET operators_press=9')
  await db.query(`UPDATE production_machines SET name='X' WHERE name='Press 1'`)
  await assert.rejects(db.query(`INSERT INTO production_machines(kind,name) VALUES('press','Press 2')`), /row-level security/)
  await as(owner)
  assert.equal((await one('SELECT operators_press FROM production_settings')).operators_press, 3, 'Operator update is filtered by RLS')
  assert.equal((await one(`SELECT count(*)::int AS n FROM production_machines WHERE name='Press 1'`)).n, 1)
})

test('print machine must match the material; runs are one per order and per machine; pressed DTF is not recorded', async () => {
  await as(owner)
  const sublim = 'bbbbbbbb-0000-4000-8000-000000000001', dtf = 'bbbbbbbb-0000-4000-8000-000000000002', other = 'bbbbbbbb-0000-4000-8000-000000000003'
  await create(sublim, 'Sublim', 40); await create(dtf, 'DTF', 6); await create(other, 'Jersey', 10)
  await move(dtf, 'DESIGN_DONE')
  await assert.rejects(db.query('SELECT printex_set_print_machine($1,$2,$3,true)', [dtf, await version(dtf), await machine('Fedar 1')]), /DTF hanya dapat dicetak di mesin DTF/)
  await db.query('SELECT printex_set_print_machine($1,$2,$3,true)', [dtf, await version(dtf), await machine('DTF 1')])
  await toPrinting(sublim, 'Fedar 1'); await toPrinting(other, 'Fedar 1')
  await as(operator)
  await db.query('SELECT printex_start_run($1)', [sublim])
  await assert.rejects(db.query('SELECT printex_start_run($1)', [sublim]), /sedang berjalan/)
  await assert.rejects(db.query('SELECT printex_start_run($1)', [other]), /Mesin masih mengerjakan SPK T-0001/)
  await db.query('SELECT printex_finish_run($1)', [sublim])
  await db.query('SELECT printex_start_run($1)', [dtf])
  // Moving the card closes a run that was left open.
  await as(owner)
  await move(dtf, 'PRESS')
  assert.equal((await one('SELECT count(*)::int AS n FROM print_runs WHERE order_id=$1 AND ended_at IS NULL', [dtf])).n, 0)
  await as(operator)
  await assert.rejects(db.query('SELECT printex_start_run($1)', [dtf]), /Press DTF memakai lini sendiri/)
  await as(owner)
  await move(sublim, 'PRESS')
  await as(operator)
  await db.query('SELECT printex_start_run($1)', [sublim])
  assert.equal((await one(`SELECT m.name FROM print_runs r JOIN production_machines m ON m.id=r.machine_id WHERE r.order_id=$1 AND r.stage='press'`, [sublim])).name, 'Press 1')
  await db.query('SELECT printex_finish_run($1)', [sublim])
})

test('efficiency inputs: run meters, standard crew x effective hours, day overrides and zero crews', async () => {
  await as(owner)
  const inputs = async () => (await one('SELECT printex_efficiency_inputs($1,$1) AS r', [today])).r
  let result = await inputs()
  const printing = result.runs.filter(row => row.stage === 'printing')
  assert.equal(printing.reduce((sum, row) => sum + Number(row.meter), 0), 46, 'Sublim 40 m + DTF 6 m')
  assert.equal(result.runs.filter(row => row.stage === 'press').reduce((sum, row) => sum + Number(row.meter), 0), 40, 'Only the Sublim press run counts')
  const crew = rows => Object.fromEntries(rows.map(row => [row.stage, [Number(row.manHours), Number(row.peopleDays)]]))
  assert.deepEqual(crew(result.shifts), { design: [7, 1], dtf: [7, 1], press: [21, 3], printing: [14, 2] })
  await db.query('SELECT printex_set_operator_shift($1,$2,$3,$4)', [today, 'press', 2, 6])
  await db.query('SELECT printex_set_operator_shift($1,$2,$3,$4)', [today, 'dtf', 0, 1])
  result = await inputs()
  assert.deepEqual(crew(result.shifts), { design: [7, 1], press: [12, 2], printing: [14, 2] })
  await db.query('SELECT printex_set_operator_shift($1,$2,NULL,1)', [today, 'dtf'])
  assert.deepEqual(crew((await inputs()).shifts).dtf, [7, 1], 'NULL returns the day to the standard crew')
  await assert.rejects(db.query(`SELECT printex_set_operator_shift(((now() AT TIME ZONE 'Asia/Jakarta')::date + 1),'press',1,1)`), /Tanggal tidak valid/)
  await as(operator)
  await assert.rejects(db.query('SELECT printex_set_operator_shift($1,$2,$3,$4)', [today, 'press', 1, 1]), /Hanya admin/)
  await db.exec('RESET ROLE')
  await assert.rejects(db.query(`INSERT INTO operator_shifts(work_date,stage,people,hours) VALUES($1,'design',51,1)`, [today]), /check/)
})

test('daily reports: output and intake per day, details, rename refresh and retained milestones of deleted orders', async () => {
  await as(owner)
  const report = async () => (await one('SELECT printex_daily_report($1,$1) AS r', [today])).r
  const total = (rows, metric, dimension) => rows.filter(row => row.metric === metric && (dimension === undefined || row.dimension === dimension)).reduce((sum, row) => ({ count: sum.count + Number(row.count), meter: sum.meter + Number(row.meter) }), { count: 0, meter: 0 })
  let result = await report()
  assert.equal(result.pending, false)
  assert.deepEqual(total(result.rows, 'output', 'sublim'), { count: 1, meter: 40 }, 'Finished Sublim print')
  assert.deepEqual(total(result.rows, 'output', 'dtf'), { count: 1, meter: 6 })
  assert.equal(total(result.rows, 'intake').count, 3)
  const details = (await one(`SELECT printex_report_details($1,$1,'process','PRINTING') AS r`, [today])).r
  assert.equal(details.total, 2)
  assert.ok(details.items.every(item => item.event.actorName === null), 'Reports never store who moved an order')
  await db.exec('RESET ROLE')
  await db.query(`UPDATE customers SET name='Renamed' WHERE id=(SELECT customer_id FROM orders WHERE spk_code='T-0001')`)
  assert.equal((await one(`SELECT count(*)::int AS n FROM report_refresh_queue q JOIN orders o ON o.id=q.order_id WHERE o.spk_code='T-0001'`)).n, 1, 'A customer rename queues its orders')
  await as(owner)
  assert.equal((await report()).pending, false)
  // A deleted order keeps its process milestones but leaves intake and output.
  const id = 'bbbbbbbb-0000-4000-8000-000000000003'
  await db.query('SELECT printex_mutate_order($1,$2,$3,$4)', ['delete', id, await version(id), {}])
  result = await report()
  assert.equal(total(result.rows, 'intake').count, 2)
  assert.equal(total(result.rows, 'process', 'DESIGN_DONE').count, 3, 'Milestone of the deleted order is retained')
  await as(operator)
  await assert.rejects(db.query('SELECT * FROM report_daily_summaries'), /permission denied/, 'Summary tables are read only through the RPC')
})

after(async () => { await db.close() })
