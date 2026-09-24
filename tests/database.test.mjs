import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test, after } from 'node:test'

const db = new PGlite()
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb DEFAULT '{}');
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
await db.query(`UPDATE public.profiles SET role='owner',is_active=true WHERE id=$1`,[admin])
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
  for(const code of ['DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE']) {
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
  assert.equal(events.filter(event=>event.event_kind==='completed').length,6)
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
  assert.deepEqual(profile,{role:'owner',is_active:true})
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

test('optional design and DTF Press skips create no events for skipped stages',async()=>{
  await db.exec('RESET ROLE; SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
  for(const productionType of ['DTF','Sublim']) {
    const key=productionType==='DTF'?'aaaaaaaa-0000-4000-8000-000000000001':'aaaaaaaa-0000-4000-8000-000000000002'
    await mutate('create',{...input,productionType},null,key)
    await mutate('move',{code:'DESIGN_DONE'},1,key)
    await mutate('move',{code:'PRINTING'},2,key)
    if(productionType==='DTF') await mutate('move',{code:'DONE'},3,key)
    else {
      await assert.rejects(()=>mutate('move',{code:'DONE'},3,key),/previous or next/)
      await mutate('move',{code:'PRESS'},3,key)
      await mutate('move',{code:'DONE'},4,key)
    }
    const events=(await db.query('SELECT s.code,h.event_kind FROM process_history h JOIN production_steps s ON s.id=h.step_id WHERE h.order_id=$1',[key])).rows
    assert.ok(events.every(event=>event.code!=='DESIGN'))
    assert.equal(events.filter(event=>event.code==='PRESS').length,productionType==='DTF'?0:2)
  }
})

test('user management restricts access, protects self, and disables deleted accounts without erasing history',async()=>{
  await db.exec('RESET ROLE; SET ROLE authenticated')
  const manage=(id,name,role,active,remove=false)=>db.query('SELECT public.printex_manage_user($1,$2,$3,$4,$5)',[id,name,role,active,remove])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
  await manage(staff,'Staf Baru','operator',true)
  await assert.rejects(()=>manage(admin,'Admin','operator',true),/akun sendiri/)
  await assert.rejects(()=>manage(admin,null,null,false,true),/akun sendiri/)
  await assert.rejects(()=>manage(staff,'Staf','invalid-role',true),/tidak valid/)
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[staff])
  await assert.rejects(()=>db.query('SELECT * FROM public.printex_list_users()'),/Owner/)
  await assert.rejects(()=>manage(staff,'Staf','owner',true),/Owner/)
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
  const count=(await db.query('SELECT count(*)::int AS n FROM process_history')).rows[0].n
  await manage(staff,null,null,false,true)
  await assert.rejects(()=>manage(staff,'Staf','operator',true),/Penghapusan/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history')).rows[0].n,count)
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[staff])
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,0)
  await db.exec('RESET ROLE')
})

test('hard deletion removes Auth and profile while preserving finalized orders and history',async()=>{
  await db.exec('RESET ROLE')
  const owner='dddddddd-0000-4000-8000-000000000001'
  const key='eeeeeeee-0000-4000-8000-000000000001'
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'removed@example.test')",[owner])
  await db.query("UPDATE profiles SET role='admin',is_active=true WHERE id=$1",[owner])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[owner])
  await db.exec('SET ROLE authenticated')
  await mutate('create',input,null,key)
  for(const [index,code] of ['DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE'].entries()) await mutate('move',{code},index+1,key)
  await mutate('archive',{deliveryMethod:'pickup'},6,key)
  await mutate('finish',{},7,key)
  const before=(await db.query('SELECT * FROM orders WHERE id=$1',[key])).rows[0]
  const historyBefore=(await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1',[key])).rows[0].n
  await db.exec('RESET ROLE')
  await db.query('DELETE FROM auth.users WHERE id=$1',[owner])
  assert.equal((await db.query('SELECT * FROM profiles WHERE id=$1',[owner])).rows.length,0)
  const after=(await db.query('SELECT * FROM orders WHERE id=$1',[key])).rows[0]
  assert.equal(after.created_by,null)
  assert.equal(String(after.archive_finalized_at),String(before.archive_finalized_at))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1',[key])).rows[0].n,historyBefore)
})

test('operator permissions are enforced by RPC and RLS across every board stage',async()=>{
  await db.exec('RESET ROLE')
  const operator='bbbbbbbb-0000-4000-8000-000000000001'
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'operator@example.test','{\"role\":\"owner\"}')",[operator])
  assert.deepEqual((await db.query('SELECT role,is_active FROM profiles WHERE id=$1',[operator])).rows[0],{role:'operator',is_active:false})
  await db.query('UPDATE profiles SET is_active=true WHERE id=$1',[operator])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[admin])
  await db.exec('SET ROLE authenticated')
  const codes=['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE','ARCHIVE']
  const rows=[]
  for(let i=0;i<codes.length;i++) {
    const key=`cccccccc-0000-4000-8000-${String(i+1).padStart(12,'0')}`
    await mutate('create',input,null,key)
    for(let step=1;step<=Math.min(i,5);step++) await mutate('move',{code:codes[step]},step,key)
    if(i===6) await mutate('archive',{deliveryMethod:'pickup'},6,key)
    rows.push((await db.query('SELECT * FROM orders WHERE id=$1',[key])).rows[0])
  }
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[operator])
  assert.equal((await db.query('SELECT * FROM orders WHERE id=ANY($1::uuid[])',[rows.map(row=>row.id)])).rows.length,7)
  assert.equal((await db.query('SELECT * FROM profiles')).rows.length,1)
  for(const action of ['create','edit','delete','archive','finish']) {
    await assert.rejects(()=>mutate(action,{...input,spkCode:'FORGED',role:'owner'},rows[0].version,rows[0].id),error=>error.code==='42501')
  }
  await assert.rejects(()=>db.query('SELECT * FROM public.printex_list_users()'),error=>error.code==='42501')
  await assert.rejects(()=>db.query("SELECT public.printex_manage_user($1,'Forged','owner',true,false)",[operator]),error=>error.code==='42501')
  for(const statement of ["UPDATE orders SET notes='forged'", "INSERT INTO customers(name) VALUES('forged')", "UPDATE profiles SET role='owner'", 'DELETE FROM process_history']) {
    await assert.rejects(()=>db.query(statement),error=>error.code==='42501')
  }
  // Roll back each attempt to test both endpoints from the same original position.
  await db.exec('BEGIN')
  for(let from=0;from<codes.length;from++) for(let to=0;to<codes.length;to++) {
    if(from===to)continue
    await db.exec('SAVEPOINT attempt')
    const request=()=>mutate('move',{code:codes[to]},rows[from].version,rows[from].id)
    const inScope=from>=2&&from<=5&&to>=2&&to<=5
    const legal=Math.abs(from-to)===1||(from===3&&to===5) // DTF retains its existing Press skip.
    if(inScope&&legal) {
      await request()
      const changed=(await db.query('SELECT current_step_id,version,notes FROM orders WHERE id=$1',[rows[from].id])).rows[0]
      assert.equal(changed.current_step_id,rows[to].current_step_id)
      assert.equal(changed.version,rows[from].version+1)
      assert.equal(changed.notes,rows[from].notes)
    } else if(!inScope) await assert.rejects(request,error=>error.code==='42501',`${codes[from]} -> ${codes[to]}`)
    else await assert.rejects(request,/previous or next/)
    await db.exec('ROLLBACK TO SAVEPOINT attempt; RELEASE SAVEPOINT attempt')
  }
  await db.exec('COMMIT')
  await assert.rejects(()=>mutate('move',{code:'PRINTING'},999,rows[2].id),/perangkat lain/)
  // A role change is effective on the next request, with no new login required.
  await db.exec('RESET ROLE')
  await db.query('UPDATE profiles SET is_active=false WHERE id=$1',[operator])
  await db.exec('SET ROLE authenticated')
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,0)
  await assert.rejects(()=>mutate('move',{code:'PRINTING'},rows[2].version,rows[2].id),error=>error.code==='42501')
  await db.exec('RESET ROLE')
})

test('role migration converts existing users in place and is safe to rerun',async()=>{
  await db.exec('RESET ROLE')
  const beforeOrders=(await db.query('SELECT * FROM orders ORDER BY id')).rows
  const beforeHistory=(await db.query('SELECT * FROM process_history ORDER BY id')).rows
  await db.exec('ALTER TABLE profiles DROP CONSTRAINT profiles_role_check')
  await db.query("UPDATE profiles SET role='superadmin' WHERE id=$1",[admin])
  await db.query("UPDATE profiles SET role='staff' WHERE id=$1",[staff])
  const beforeProfiles=(await db.query('SELECT * FROM profiles ORDER BY id')).rows
  const migration=readFileSync('supabase/migrations/0013_owner_operator_permissions.sql','utf8')
  await db.exec(migration)
  await db.exec(migration)
  const afterProfiles=(await db.query('SELECT * FROM profiles ORDER BY id')).rows
  assert.deepEqual(afterProfiles,beforeProfiles.map(profile=>({...profile,role:profile.role==='superadmin'?'owner':profile.role==='staff'?'operator':profile.role})))
  assert.deepEqual((await db.query('SELECT * FROM orders ORDER BY id')).rows,beforeOrders)
  assert.deepEqual((await db.query('SELECT * FROM process_history ORDER BY id')).rows,beforeHistory)
  await assert.rejects(()=>db.query("UPDATE profiles SET role='superadmin' WHERE id=$1",[admin]),/profiles_role_check/)
})

test('customer service contact is shared, admin-managed and protected by RLS', async () => {
  await db.exec('RESET ROLE')
  const csOwner = '77777777-0000-4000-8000-000000000001'
  const csAdmin = '77777777-0000-4000-8000-000000000002'
  const csOperator = '77777777-0000-4000-8000-000000000003'
  for (const [uid, role] of [[csOwner, 'owner'], [csAdmin, 'admin'], [csOperator, 'operator']]) {
    await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, role+'-cs@example.test'])
    await db.query('UPDATE profiles SET role=$2,is_active=true WHERE id=$1', [uid, role])
  }
  await db.exec('SET ROLE authenticated')
  const setUser = uid => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid])
  const read = () => db.query('SELECT whatsapp_number FROM customer_service_settings')
  const update = number => db.query('UPDATE customer_service_settings SET whatsapp_number=$1 WHERE singleton=true RETURNING whatsapp_number', [number])
  await setUser(csAdmin)
  assert.equal((await update('6281234567890')).rows[0].whatsapp_number, '6281234567890')
  await assert.rejects(() => update('javascript:alert(1)'), /check constraint/)
  await assert.rejects(() => db.query('INSERT INTO customer_service_settings DEFAULT VALUES'), /permission denied/)
  await setUser(csOperator)
  assert.equal((await read()).rows[0].whatsapp_number, '6281234567890')
  assert.equal((await update('6289999999999')).rows.length, 0)
  await assert.rejects(() => db.query('DELETE FROM customer_service_settings'), /permission denied/)
  await setUser(csOwner)
  assert.equal((await read()).rows[0].whatsapp_number, '6281234567890')
  assert.equal((await update('')).rows[0].whatsapp_number, '')
  await update('6289876543210')
  await db.exec('RESET ROLE')
  const migration = readFileSync('supabase/migrations/0014_customer_service.sql', 'utf8')
  await db.exec(migration); await db.exec(migration)
  assert.equal((await read()).rows[0].whatsapp_number, '6289876543210')
  await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [csAdmin])
  await db.exec('SET ROLE authenticated')
  await setUser(csAdmin)
  assert.equal((await read()).rows.length, 0)
  assert.equal((await update('6281111111111')).rows.length, 0)
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(read, /permission denied/)
  await db.exec('RESET ROLE')
})

after(async()=>{await db.close()})
