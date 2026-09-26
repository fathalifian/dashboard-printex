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
// Supabase owns this schema in production; model Storage metadata and RLS locally.
await db.exec(`CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,created_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;`)
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

test('optional photos enforce private storage, ownership roles, concurrency, and archive immutability', async () => {
  await db.exec('RESET ROLE')
  const owner = 'aaaaaaaa-1111-4000-8000-000000000001'
  const operator = 'aaaaaaaa-1111-4000-8000-000000000002'
  const orderId = 'aaaaaaaa-2222-4000-8000-000000000001'
  const path = `${orderId}/aaaaaaaa-3333-4000-8000-000000000001.jpg`
  const replacement = `${orderId}/aaaaaaaa-3333-4000-8000-000000000002.png`
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'photo-owner@test.local'),($2,'photo-operator@test.local')", [owner, operator])
  await db.query("UPDATE profiles SET role=CASE WHEN id=$1 THEN 'owner' ELSE 'operator' END,is_active=true WHERE id IN ($1,$2)", [owner, operator])
  const user = id => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id])
  const row = async () => (await db.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0]
  const link = (path, version) => db.query('SELECT printex_set_order_photo($1,$2,$3)', [orderId, version, path])
  const upload = path => db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-photos',$1)", [path])
  await db.exec('SET ROLE authenticated'); await user(owner)
  await mutate('create', input, null, orderId)
  assert.equal((await row()).photo_path, null)
  await assert.rejects(() => link(path, 1), /belum diunggah/)
  await assert.rejects(() => upload('wrong-folder/photo.jpg'), /row-level security/)
  await upload(path)
  await assert.rejects(() => link('bbbbbbbb-2222-4000-8000-000000000001/photo.jpg', 1), /tidak valid/)
  const historyBefore = (await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1', [orderId])).rows[0].n
  await link(path, 1)
  assert.equal((await row()).photo_path, path)
  assert.equal((await row()).version, 2)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1', [orderId])).rows[0].n, historyBefore)
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [path])).rows.length, 0)
  await upload(replacement)
  await assert.rejects(() => link(replacement, 1), /perangkat lain/)
  await user(operator)
  assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1', [path])).rows.length, 1)
  await assert.rejects(() => link(null, 2), /Owner\/Admin/)
  await assert.rejects(() => upload(`${orderId}/aaaaaaaa-3333-4000-8000-000000000003.jpg`), /row-level security/)
  await user(owner)
  await link(replacement, 2)
  await db.query('SELECT * FROM printex_claim_photo_cleanup($1)', [path])
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [path])).rows.length, 1)
  await link(null, 3)
  assert.equal((await row()).photo_path, null)
  await link(replacement, 4)
  for (const code of ['DESIGN_DONE','PRINTING','DONE']) await mutate('move', { code }, (await row()).version, orderId)
  await mutate('archive', { deliveryMethod: 'pickup' }, (await row()).version, orderId)
  await assert.rejects(async () => link(null, (await row()).version), /arsip/)
  assert.equal((await row()).photo_path, replacement)
  await db.exec('RESET ROLE')
  const migration = readFileSync('supabase/migrations/0015_order_photos.sql', 'utf8')
  await db.exec(migration); await db.exec(migration)
  await db.exec(readFileSync('supabase/migrations/0016_photo_cleanup.sql', 'utf8'))
  assert.equal((await row()).photo_path, replacement)
  await mutate('finish', {}, (await row()).version, orderId)
  assert.equal((await row()).photo_path, null)
  assert.ok((await row()).archive_finalized_at)
  const finishedVersion = (await row()).version
  await mutate('finish', {}, finishedVersion, orderId)
  assert.equal((await row()).version, finishedVersion)
  assert.deepEqual((await db.query('SELECT * FROM printex_claim_photo_cleanup($1)', [replacement])).rows, [{ path: replacement }])
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [replacement])).rows.length, 1)
  assert.ok((await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1', [orderId])).rows[0].n >= historyBefore)
  assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='order-photos'")).rows[0].public, false)
  await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [operator])
  await db.exec('SET ROLE authenticated'); await user(operator)
  assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='order-photos'")).rows.length, 0)
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(() => db.query('SELECT * FROM storage.objects'), /permission denied/)
  await db.exec('RESET ROLE')
})

test('cleanup claims only orphan photos, retries safely, and queues photos on permanent order deletion', async () => {
  await db.exec('RESET ROLE')
  await db.exec(readFileSync('supabase/migrations/0016_photo_cleanup.sql', 'utf8'))
  const owner = 'aaaaaaaa-1111-4000-8000-000000000001'
  const orderId = 'cccccccc-2222-4000-8000-000000000001'
  const attached = `${orderId}/cccccccc-3333-4000-8000-000000000001.webp`
  const orphan = `${orderId}/cccccccc-3333-4000-8000-000000000002.webp`
  const fresh = `${orderId}/cccccccc-3333-4000-8000-000000000003.webp`
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner])
  await db.exec('SET ROLE authenticated')
  await mutate('create', input, null, orderId)
  for (const path of [attached, orphan, fresh]) await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-photos',$1)", [path])
  await db.query('SELECT printex_set_order_photo($1,1,$2)', [orderId, attached])
  await db.exec('RESET ROLE')
  await db.query("UPDATE storage.objects SET created_at=now()-interval '2 days' WHERE name IN ($1,$2)", [attached, orphan])
  await db.exec('SET ROLE authenticated')
  const claim = path => db.query('SELECT * FROM printex_claim_photo_cleanup($1)', [path])
  assert.deepEqual((await claim(attached)).rows, []) // Lost response after link: never delete it.
  const candidates = (await claim(null)).rows.map(row => row.path)
  assert.ok(candidates.includes(orphan))
  assert.ok(!candidates.includes(attached))
  assert.ok(!candidates.includes(fresh)) // In-progress uploads get a 24h grace period.
  assert.deepEqual((await claim(orphan)).rows, [{ path: orphan }]) // Retry after failed Storage API.
  await assert.rejects(() => db.query('SELECT printex_set_order_photo($1,2,$2)', [orderId, orphan]), /dibersihkan/)
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [orphan])).rows.length, 1)
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [fresh])).rows.length, 0)
  await claim(fresh) // Explicit failed upload can be removed immediately.
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [fresh])).rows.length, 1)
  await mutate('delete', {}, 2, orderId)
  assert.deepEqual((await claim(null)).rows.filter(row => row.path === attached), [{ path: attached }])
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [attached])).rows.length, 1)
  await db.exec('RESET ROLE')
  await db.query("UPDATE order_photo_cleanup SET queued_at=now()-interval '2 days'")
  await db.exec('SET ROLE authenticated'); await claim(null)
  await assert.rejects(() => db.query('SELECT * FROM order_photo_cleanup'), /permission denied/)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT * FROM order_photo_cleanup WHERE path IN ($1,$2,$3)', [attached, orphan, fresh])).rows.length, 0)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", ['aaaaaaaa-1111-4000-8000-000000000002'])
  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => claim(null), /Owner\/Admin/)
  await db.exec('RESET ROLE')
})

test('shared stock shortcuts persist Owner/Admin edits while RLS denies Operator, inactive and anonymous writes', async () => {
  await db.exec('RESET ROLE')
  const shortcutAdmin = 'dddddddd-1111-4000-8000-000000000001'
  const shortcutOwner = 'dddddddd-1111-4000-8000-000000000002'
  const shortcutOperator = 'dddddddd-1111-4000-8000-000000000003'
  for (const [id, role] of [[shortcutAdmin, 'admin'], [shortcutOwner, 'owner'], [shortcutOperator, 'operator']]) {
    await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${role}-shortcut@test.local`])
    await db.query('UPDATE profiles SET role=$2,is_active=true WHERE id=$1', [id, role])
  }
  const user = id => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id])
  const read = () => db.query('SELECT * FROM stock_shortcuts ORDER BY id')
  const update = (label, version = 1) => db.query("UPDATE stock_shortcuts SET label=$1,url='https://docs.google.com/spreadsheets/d/updated/edit#gid=1',version=version+1 WHERE id='dtf_paper' AND version=$2 RETURNING *", [label, version])
  await db.exec('SET ROLE authenticated')
  for (const id of [shortcutOperator]) {
    await user(id)
    assert.equal((await read()).rows.length, 2)
    assert.equal((await update('Forbidden')).rows.length, 0)
  }
  await user(shortcutAdmin)
  const edited = (await update('Persediaan DTF')).rows[0]
  assert.equal(edited.label, 'Persediaan DTF')
  assert.equal(Number(edited.version), 2)
  assert.equal((await update('Stale')).rows.length, 0)
  await assert.rejects(() => db.query("UPDATE stock_shortcuts SET url='javascript:alert(1)' WHERE id='fabric'"), /check constraint/)
  await assert.rejects(() => db.query("UPDATE stock_shortcuts SET label='' WHERE id='fabric'"), /check constraint/)
  await assert.rejects(() => db.query("DELETE FROM stock_shortcuts WHERE id='fabric'"), /permission denied/)
  await assert.rejects(() => db.query("UPDATE stock_shortcuts SET id='other' WHERE id='fabric'"), /permission denied/)
  await db.exec('RESET ROLE')
  const migration = readFileSync('supabase/migrations/0017_stock_shortcuts.sql', 'utf8')
  await db.exec(migration); await db.exec(migration)
  const ownerMigration = readFileSync('supabase/migrations/0018_owner_stock_shortcuts.sql', 'utf8')
  await db.exec(ownerMigration); await db.exec(ownerMigration)
  assert.equal((await read()).rows[0].label, 'Persediaan DTF')
  await db.exec('SET ROLE authenticated')
  await user(shortcutOwner)
  const ownerEdit = (await update('Stok dari Owner', 2)).rows[0]
  assert.equal(ownerEdit.label, 'Stok dari Owner')
  assert.equal(Number(ownerEdit.version), 3)
  await db.exec('RESET ROLE')
  await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [shortcutOwner])
  await db.exec('SET ROLE authenticated')
  assert.equal((await read()).rows.length, 0)
  assert.equal((await update('Inactive', 3)).rows.length, 0)
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(read, /permission denied/)
  await db.exec('RESET ROLE')
})

test('archive photo repair restores missing dependencies and is safe to rerun', async () => {
  await db.exec('RESET ROLE')
  const before = (await db.query('SELECT * FROM orders ORDER BY id')).rows
  const historyBefore = (await db.query('SELECT * FROM process_history ORDER BY id')).rows
  await db.exec('DROP FUNCTION public.printex_queue_old_photo() CASCADE')
  const repair = readFileSync('supabase/REPAIR_ARCHIVE_PHOTOS.sql', 'utf8')
  await db.exec(repair)
  await db.exec(repair)
  assert.deepEqual((await db.query('SELECT * FROM orders ORDER BY id')).rows, before)
  assert.deepEqual((await db.query('SELECT * FROM process_history ORDER BY id')).rows, historyBefore)
  const owner = 'aaaaaaaa-1111-4000-8000-000000000001'
  const orderId = 'eeeeeeee-2222-4000-8000-000000000001'
  const path = orderId + '/eeeeeeee-3333-4000-8000-000000000001.webp'
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner])
  await db.exec('SET ROLE authenticated')
  await mutate('create', input, null, orderId)
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-photos',$1)", [path])
  await db.query('SELECT printex_set_order_photo($1,1,$2)', [orderId,path])
  const row = async () => (await db.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0]
  for (const code of ['DESIGN_DONE','PRINTING','DONE']) await mutate('move', {code}, (await row()).version, orderId)
  await mutate('archive', {deliveryMethod:'pickup'}, (await row()).version, orderId)
  assert.equal((await row()).photo_path, path)
  await mutate('finish', {}, (await row()).version, orderId)
  assert.equal((await row()).photo_path, null)
  assert.deepEqual((await db.query('SELECT * FROM printex_claim_photo_cleanup($1)',[path])).rows, [{path}])
  await db.exec('RESET ROLE')
})

test('optional WhatsApp persists, supports empty values, and survives edits from older clients', async () => {
  await db.exec('RESET ROLE')
  await db.exec(readFileSync('supabase/migrations/0020_optional_customer_phone.sql', 'utf8'))
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [admin])
  await db.exec('SET ROLE authenticated')
  const orderId = 'ffffffff-2222-4000-8000-000000000001'
  await mutate('create', {...input, customerPhone:' 081234567890 '}, null, orderId)
  const read = async () => (await db.query('SELECT o.version,o.spk_code,c.phone FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1',[orderId])).rows[0]
  assert.equal((await read()).phone, '081234567890')
  let r=await read()
  await mutate('edit', {...input,spkCode:r.spk_code}, r.version, orderId)
  assert.equal((await read()).phone, '081234567890')
  r=await read()
  await mutate('edit', {...input,spkCode:r.spk_code,customerPhone:''}, r.version, orderId)
  assert.equal((await read()).phone, null)
  await db.exec('RESET ROLE')
})


test('incremental cursor records deletes, denies anonymous reads and rolls back with failed transactions',async()=>{
 await db.exec('RESET ROLE')
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[admin])
 await db.query("UPDATE profiles SET role='owner',is_active=true WHERE id=$1",[admin])
 await db.exec('SET ROLE authenticated')
 const start=(await db.query('SELECT printex_sync_changes(NULL,NULL) AS s')).rows[0].s
 await db.exec('RESET ROLE')
 await db.exec("BEGIN; INSERT INTO customers(id,name) VALUES('eeeeeeee-0000-4000-8000-000000000001','Rollback'); ROLLBACK;")
 const afterRollback=(await db.query('SELECT printex_sync_changes(NULL,NULL) AS s')).rows[0].s
 assert.equal(afterRollback.cursor,start.cursor)
 await db.exec("INSERT INTO customers(id,name) VALUES('eeeeeeee-0000-4000-8000-000000000001','Temporary'); DELETE FROM customers WHERE id='eeeeeeee-0000-4000-8000-000000000001';")
 const delta=(await db.query('SELECT printex_sync_changes($1,NULL) AS s',[start.cursor])).rows[0].s
 assert.ok(delta.changes.some(change=>change.table==='customers'&&change.id==='eeeeeeee-0000-4000-8000-000000000001'))
 await db.exec("INSERT INTO customers(id,name) SELECT gen_random_uuid(),'Batch sync' FROM generate_series(1,2001)")
 const bulk=(await db.query('SELECT printex_sync_changes($1,NULL) AS s',[delta.cursor])).rows[0].s
 assert.equal(bulk.reset,true)
 assert.deepEqual(bulk.changes,[])
 await db.exec('SET ROLE anon')
 await assert.rejects(()=>db.query('SELECT printex_sync_changes(NULL,NULL)'),/permission denied/)
 await db.exec('RESET ROLE')
})

test('official branch migrations install on a legacy database without rewriting order contents',async()=>{
 await db.exec('RESET ROLE')
 // Real Supabase Auth includes this metadata column.
 await db.exec("ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{}'")
 const before=(await db.query('SELECT id,spk_code,version,notes FROM orders ORDER BY id')).rows
 await db.exec("SET printex.legacy_branch='Salatiga'")
 for(const file of readdirSync('supabase/branch-migrations').filter(file=>file.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/branch-migrations/'+file,'utf8'))
 assert.deepEqual((await db.query('SELECT id,spk_code,version,notes FROM orders ORDER BY id')).rows,before)
 assert.ok((await db.query('SELECT branch_id FROM orders')).rows.every(row=>row.branch_id==='11111111-1111-4111-8111-111111111111'))
 assert.equal((await db.query('SELECT * FROM branch_stock_shortcuts')).rows.length,4)
})

after(async()=>{await db.close()})
