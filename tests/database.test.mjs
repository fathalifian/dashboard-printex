import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test, after } from 'node:test'

const db = new PGlite()
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE PUBLICATION supabase_realtime;`)
for(const file of readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort()) {
  const sql=readFileSync('supabase/migrations/'+file,'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/,'')
  try {await db.exec(sql)}catch(error){console.error('Migration failed:',file,error.message);throw error}
}
const admin='00000000-0000-4000-8000-000000000001'
const staff='00000000-0000-4000-8000-000000000002'
await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'admin@example.test'),($2,'staff@example.test')`,[admin,staff])
await db.query(`UPDATE public.profiles SET role='superadmin',is_active=true WHERE id=$1`,[admin])
await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
await db.exec('SET ROLE authenticated')
const input={customerName:'Test Customer',productionType:'DTF',meter:20,customerType:'regular',orderDate:'2026-09-07',dueDate:'2026-09-09',notes:''}
const id='11111111-0000-4000-8000-000000000001'
async function mutate(action,data={},version=null,orderId=id) { return db.query('SELECT public.printex_mutate_order($1,$2,$3,$4)',[action,orderId,version,data]) }
async function order(){return (await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0]}

test('database migrations, RLS, transactional CRUD, versions and archive lifecycle',async()=>{
  await mutate('create',input)
  let row=await order()
  assert.equal(row.order_state,'active')
  assert.equal((await db.query('SELECT count(*)::int AS count FROM process_history')).rows[0].count,1)
  await mutate('create',input)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM orders')).rows[0].count,1)
  await assert.rejects(()=>mutate('move',{code:'DONE'},row.version),/previous or next/)
  assert.equal((await order()).version,1)
  for(const code of ['DESIGN','DESIGN_DONE','PRINTING','DONE']) {
    row=await order();await mutate('move',{code},row.version)
  }
  row=await order();assert.equal(row.order_state,'completed')
  await assert.rejects(()=>mutate('edit',{...input,spkCode:'SPK-X'},1),/perangkat lain/)
  await mutate('archive',{deliveryMethod:'pickup'},row.version)
  row=await order();assert.ok(row.archived_at)
  await mutate('finish',{},row.version)
  row=await order();assert.ok(row.archive_finalized_at)
  const at=String(row.archive_finalized_at)
  await mutate('finish',{},row.version)
  assert.equal(String((await order()).archive_finalized_at),at)
  await assert.rejects(async()=>mutate('delete',{},(await order()).version),/Preserve archived/)
  await assert.rejects(()=>db.query("UPDATE orders SET notes='forged' WHERE id=$1",[id]),/permission denied/)
  const events=(await db.query('SELECT * FROM process_history')).rows
  assert.ok(events.every(event=>event.customer_name==='Test Customer'))
  assert.equal(events.filter(event=>event.event_kind==='completed').length,5)
})

test('inactive staff and anonymous users cannot read business data or write',async()=>{
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[staff])
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,0)
  await assert.rejects(()=>mutate('create',input,null,'22222222-0000-4000-8000-000000000002'),/belum diberi akses/)
  await db.exec('RESET ROLE; SET ROLE anon;')
  await assert.rejects(()=>db.query('SELECT * FROM orders'),/permission denied/)
  await db.exec('RESET ROLE; SET ROLE authenticated;')
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
})

test('online setup can run twice without changing existing orders or history',async()=>{
  await db.exec('RESET ROLE')
  const beforeOrders=(await db.query('SELECT * FROM orders ORDER BY id')).rows
  const beforeHistory=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  const setup=readFileSync('supabase/SETUP_ONLINE.sql','utf8')
  await db.exec("CREATE FUNCTION public.printex_import_local(jsonb) RETURNS void LANGUAGE sql AS 'SELECT'")
  await db.exec(setup)
  await db.exec(setup)
  assert.equal((await db.query("SELECT to_regprocedure('public.printex_import_local(jsonb)') AS fn")).rows[0].fn,null)
  assert.deepEqual((await db.query('SELECT * FROM orders ORDER BY id')).rows,beforeOrders)
  assert.deepEqual((await db.query('SELECT * FROM process_history ORDER BY id')).rows,beforeHistory)
  await db.query("INSERT INTO auth.users(id,email) VALUES('99999999-0000-4000-8000-000000000001','fathalifian@gmail.com')")
  const activate=readFileSync('supabase/ACTIVATE_ADMIN.sql','utf8')
  await db.exec(activate)
  await db.exec(activate)
  const profile=(await db.query("SELECT role,is_active FROM profiles WHERE id='99999999-0000-4000-8000-000000000001'")).rows[0]
  assert.deepEqual(profile,{role:'superadmin',is_active:true})
})

test('manual reset replaces old and archived orders with twenty new tracked incoming orders',async()=>{
  await db.exec('RESET ROLE')
  const reset=readFileSync('supabase/RESET_20_ORDERS.sql','utf8')
  for(let run=0;run<2;run++) {
    await db.exec(reset)
    const rows=(await db.query('SELECT o.*,s.code FROM orders o JOIN production_steps s ON s.id=o.current_step_id')).rows
    assert.equal(rows.length,20)
    assert.equal(new Set(rows.map(row=>row.id)).size,20)
    assert.equal(new Set(rows.map(row=>row.production_type)).size,5)
    assert.ok(rows.every(row=>row.code==='ORDER_IN' && row.archive_finalized_at===null))
    assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history')).rows[0].n,20)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM orders WHERE order_date=(statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date")).rows[0].n,20)
    assert.ok((await db.query('SELECT * FROM profiles')).rows.length>0)
  }
})

after(async()=>{await db.close()})
