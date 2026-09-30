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


// Test the optional pilot separately so the single-branch migrations remain compatible.
await mutate('create',input)
await db.exec('RESET ROLE')
await db.exec("SET printex.legacy_branch='Salatiga'")
await db.exec(readFileSync('supabase/pilot/SETUP_TWO_BRANCHES.sql','utf8'))
await db.exec(readFileSync('supabase/pilot/SETUP_TWO_BRANCHES.sql','utf8'))
await db.query("UPDATE profiles SET role='central_owner' WHERE id=$1",[admin])
const salatiga='11111111-1111-4111-8111-111111111111'
const semarang='22222222-2222-4222-8222-222222222222'
const smgAdmin='bbbbbbbb-0000-4000-8000-000000000001'
const smgOrder='bbbbbbbb-0000-4000-8000-000000000002'
const photo=smgOrder+'/bbbbbbbb-0000-4000-8000-000000000003.webp'
await db.query("INSERT INTO auth.users(id,email) VALUES($1,'semarang@test.local')",[smgAdmin])
await db.query("UPDATE profiles SET role='admin',is_active=true,branch_id=$2 WHERE id=$1",[smgAdmin,semarang])
const login=async user=>{
 await db.exec('RESET ROLE')
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user])
 await db.exec('SET ROLE authenticated')
}

test('pilot preserves legacy data and gives central owner both branches',async()=>{
 await login(admin)
 const ctx=(await db.query('SELECT printex_branch_context() AS data')).rows[0].data
 assert.equal(ctx.central,true)
 assert.equal(ctx.branches.length,2)
 assert.equal((await order()).branch_id,salatiga)
 await mutate('create',{...input,branchId:semarang},null,smgOrder)
 assert.equal((await db.query('SELECT * FROM orders')).rows.length,2)
})

test('branch accounts cannot read or mutate another branch even through RPC',async()=>{
 await login(smgAdmin)
 assert.equal((await db.query('SELECT * FROM orders')).rows.length,1)
 assert.equal((await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows.length,0)
 assert.equal((await db.query('SELECT * FROM customers')).rows.length,1)
 assert.ok((await db.query('SELECT * FROM process_history')).rows.every(row=>row.branch_id===semarang))
 await assert.rejects(()=>mutate('edit',{...input,spkCode:'FORGED'},1,id),/cabang/)
 await assert.rejects(()=>mutate('create',{...input,branchId:salatiga},null,'cccccccc-0000-4000-8000-000000000001'),/cabang/)
 await assert.rejects(()=>mutate('create',input,null,id),/cabang/)
 await assert.rejects(()=>db.query('SELECT * FROM printex_list_users()'),/Owner Pusat/)
 await assert.rejects(()=>db.query("SELECT printex_manage_user($1,'Hack','central_owner',true,false)",[smgAdmin]),/Owner/)
 await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-photos',$1)",[photo])
 await db.query('SELECT printex_set_order_photo($1,1,$2)',[smgOrder,photo])
 await login(staff)
 await db.exec('RESET ROLE')
 await db.query("UPDATE profiles SET is_active=true WHERE id=$1",[staff])
 await db.exec('SET ROLE authenticated')
 assert.equal((await db.query('SELECT * FROM storage.objects WHERE name=$1',[photo])).rows.length,0)
 await assert.rejects(()=>db.query('SELECT printex_set_order_photo($1,2,$2)',[smgOrder,photo]))
})

test('archive cleanup retains branch isolation and central management assigns accounts',async()=>{
 await login(smgAdmin)
 const row=async()=> (await db.query('SELECT * FROM orders WHERE id=$1',[smgOrder])).rows[0]
 for(const code of ['DESIGN_DONE','PRINTING','DONE'])await mutate('move',{code},(await row()).version,smgOrder)
 await mutate('archive',{deliveryMethod:'pickup'},(await row()).version,smgOrder)
 await mutate('finish',{},(await row()).version,smgOrder)
 assert.equal((await row()).photo_path,null)
 assert.deepEqual((await db.query('SELECT * FROM printex_claim_photo_cleanup($1)',[photo])).rows,[{path:photo}])
 await login(admin)
 await db.query("SELECT printex_manage_branch_user($1,'Operator Salatiga','operator',true,$2)",[staff,salatiga])
 await assert.rejects(()=>db.query("SELECT printex_manage_branch_user($1,'Owner','admin',true,$2)",[admin,salatiga]),/sendiri/)
})
test('activation bundle enables the three trial accounts without rewriting existing orders',async()=>{
 await db.exec('RESET ROLE')
 const sql=readFileSync('supabase/pilot/ACTIVATE_SALATIGA_SEMARANG.sql','utf8')
 const trial=[
 ['a542dd4f-5967-4892-9ea1-fa386e947ef4','owner.pusat@printex.test'],
 ['f41189f2-4bf1-43b1-9812-cfb60ae21587','admin.salatiga@printex.test'],
 ['b4d51953-05eb-40fd-a6df-4b7bba2bb249','admin.semarang@printex.test']
 ]
 for(const [user,email] of trial) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,email])
 const before=(await db.query('SELECT * FROM orders ORDER BY id')).rows
 await db.exec(sql)
 await db.exec(sql)
 assert.deepEqual((await db.query('SELECT * FROM orders ORDER BY id')).rows,before)
 await login(trial[0][0])
 assert.equal((await db.query('SELECT printex_branch_context() AS c')).rows[0].c.central,true)
 await login(trial[2][0])
 assert.ok((await db.query('SELECT * FROM orders')).rows.every(row=>row.branch_id===semarang))
 assert.equal((await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows.length,0)
 await assert.rejects(()=>mutate('move',{code:'DESIGN_DONE'},1,id),/cabang/)
})
test('branch owner manages only Admin/Operator in their branch and cannot claim another profile',async()=>{
 await db.exec('RESET ROLE')
 await db.exec("ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{}'")
 await db.exec(readFileSync('supabase/pilot/ENABLE_BRANCH_OWNER_USERS.sql','utf8'))
 await db.exec(readFileSync('supabase/pilot/ENABLE_BRANCH_OWNER_USERS.sql','utf8'))
 await db.query("UPDATE profiles SET role='owner',is_active=true,branch_id=$2 WHERE id=$1",[staff,salatiga])
 const newId='dddddddd-0000-4000-8000-000000000001'
 const unrelated='dddddddd-0000-4000-8000-000000000002'
 await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,'new-admin@test.local',$2),($3,'unrelated@test.local','{}')",[newId,{provisioned_by:staff,provisioned_branch:salatiga},unrelated])
 await login(staff)
 const manage=(target,role,branch)=>db.query("SELECT printex_manage_branch_user($1,'Staff', $2,true,$3)",[target,role,branch])
 await assert.rejects(()=>manage(newId,'central_owner',salatiga),/cabang/)
 await assert.rejects(()=>manage(newId,'admin',semarang),/cabang/)
 await assert.rejects(()=>manage(unrelated,'admin',salatiga),/hak kelola/)
 await manage(newId,'admin',salatiga)
 assert.ok((await db.query('SELECT * FROM printex_list_users()')).rows.some(row=>row.id===newId))
 assert.ok(!(await db.query('SELECT * FROM printex_list_users()')).rows.some(row=>row.id===smgAdmin))
 assert.equal((await db.query('SELECT branch_id FROM profiles WHERE id=$1',[newId])).rows[0].branch_id,salatiga)
 await assert.rejects(()=>manage(smgAdmin,'operator',salatiga),/hak kelola/)
 await assert.rejects(()=>manage(admin,'operator',salatiga),/hak kelola/)
 await assert.rejects(()=>db.query("SELECT printex_manage_user($1,null,null,false,true)",[smgAdmin]),/cabang/)
 await manage(newId,'operator',salatiga)
 await db.query("SELECT printex_manage_user($1,null,null,false,true)",[newId])
 assert.equal((await db.query('SELECT is_active FROM profiles WHERE id=$1',[newId])).rows[0].is_active,false)
})
test('branch settings isolate reads and writes while central owner manages every branch', async () => {
 await db.exec('RESET ROLE')
 const sql = readFileSync('supabase/pilot/ENABLE_BRANCH_SETTINGS.sql','utf8')
 await db.exec(sql)
 await db.exec(sql)
 await login(admin)
 assert.equal((await db.query('SELECT * FROM branch_stock_shortcuts')).rows.length,4)
 assert.ok((await db.query('SELECT * FROM branch_stock_shortcuts')).rows.every(row=>row.url===''))
 await db.query("UPDATE branch_customer_service_settings SET whatsapp_number='628111111111' WHERE branch_id=$1",[salatiga])
 await db.query("UPDATE branch_customer_service_settings SET whatsapp_number='628222222222' WHERE branch_id=$1",[semarang])
 await db.query("UPDATE branch_stock_shortcuts SET url='https://example.com/salatiga',version=2 WHERE branch_id=$1",[salatiga])
 await login(smgAdmin)
 assert.deepEqual((await db.query('SELECT whatsapp_number FROM branch_customer_service_settings')).rows,[{whatsapp_number:'628222222222'}])
 assert.equal((await db.query('SELECT * FROM branch_stock_shortcuts')).rows.length,2)
 assert.equal((await db.query("UPDATE branch_stock_shortcuts SET url='https://example.com/forged' WHERE branch_id=$1 RETURNING id",[salatiga])).rows.length,0)
 await db.query("UPDATE branch_stock_shortcuts SET url='https://example.com/semarang' WHERE branch_id=$1",[semarang])
 await assert.rejects(()=>db.query('SELECT * FROM stock_shortcuts'),/permission denied/)
 await assert.rejects(()=>db.query('SELECT * FROM customer_service_settings'),/permission denied/)
 await login(staff)
 await db.query("UPDATE branch_customer_service_settings SET whatsapp_number='628333333333' WHERE branch_id=$1",[salatiga])
 assert.equal((await db.query("UPDATE branch_customer_service_settings SET whatsapp_number='' WHERE branch_id=$1 RETURNING branch_id",[semarang])).rows.length,0)
 await db.exec('RESET ROLE')
 await db.query("UPDATE profiles SET role='operator' WHERE id=$1",[staff])
 await login(staff)
 assert.equal((await db.query("UPDATE branch_customer_service_settings SET whatsapp_number='' RETURNING branch_id")).rows.length,0)
 await login(admin)
 assert.equal((await db.query('SELECT whatsapp_number FROM branch_customer_service_settings WHERE branch_id=$1',[salatiga])).rows[0].whatsapp_number,'628333333333')
 assert.equal((await db.query('SELECT url FROM branch_stock_shortcuts WHERE branch_id=$1 LIMIT 1',[salatiga])).rows[0].url,'https://example.com/salatiga')
 await db.exec('RESET ROLE')
 await db.query("INSERT INTO branches(name) VALUES('Cabang baru')")
 assert.equal((await db.query('SELECT * FROM branch_stock_shortcuts')).rows.length,6)
 await db.exec(sql)
 assert.equal((await db.query('SELECT whatsapp_number FROM branch_customer_service_settings WHERE branch_id=$1',[salatiga])).rows[0].whatsapp_number,'628333333333')
})


test('official upgrade preserves pilot data and exposes branch capabilities; cursor cannot cross branches',async()=>{
 await db.exec('RESET ROLE')
 const before=(await db.query('SELECT * FROM orders ORDER BY id')).rows
 const sql=readFileSync('supabase/UPGRADE_BRANCHES.sql','utf8')
 await db.exec(sql)
 await db.exec(sql)
 assert.deepEqual((await db.query('SELECT * FROM orders ORDER BY id')).rows,before)
 await login(admin)
 const status=(await db.query('SELECT printex_online_status() AS s')).rows[0].s
 assert.equal(status.branch_schema_version,4)
 assert.equal(status.branch_settings_enabled,true)
 await db.exec('RESET ROLE')
 await assert.rejects(()=>db.exec(readFileSync('supabase/SETUP_ONLINE.sql','utf8')),/UPGRADE_BRANCHES/)
 await db.exec('ROLLBACK')
 await login(admin)
 assert.equal((await db.query('SELECT printex_online_status() AS s')).rows[0].s.branch_schema_version,4)
 const start=(await db.query('SELECT printex_sync_changes(NULL,$1) AS s',[salatiga])).rows[0].s
 await db.exec('RESET ROLE')
 await db.query("UPDATE orders SET notes='sync test' WHERE id=$1",[id])
 await login(admin)
 const delta=(await db.query('SELECT printex_sync_changes($1,$2) AS s',[start.cursor,salatiga])).rows[0].s
 assert.ok(delta.changes.some(change=>change.table==='orders'&&change.id===id))
 await login(smgAdmin)
 await assert.rejects(()=>db.query('SELECT printex_sync_changes(NULL,$1)',[salatiga]),/Cabang/)
 await assert.rejects(()=>db.query('SELECT printex_sync_changes(NULL,NULL)'),/Cabang/)
 const own=(await db.query('SELECT printex_sync_changes($1,$2) AS s',[start.cursor,semarang])).rows[0].s
 assert.ok(!own.changes.some(change=>change.id===id))
 await assert.rejects(()=>db.query('SELECT * FROM printex_row_changes'),/permission denied/)
})


test('shared support number is identical across branches, operator read-only, branch endpoints retired',async()=>{
 await login(admin)
 await db.query("UPDATE customer_service_settings SET whatsapp_number='6281234567890' WHERE singleton")
 await login(smgAdmin)
 assert.equal((await db.query('SELECT whatsapp_number FROM customer_service_settings')).rows[0].whatsapp_number,'6281234567890')
 await db.query("UPDATE customer_service_settings SET whatsapp_number='628222222222' WHERE singleton")
 await login(staff)
 assert.equal((await db.query('SELECT whatsapp_number FROM customer_service_settings')).rows[0].whatsapp_number,'628222222222')
 assert.equal((await db.query("UPDATE customer_service_settings SET whatsapp_number='' WHERE singleton RETURNING singleton")).rows.length,0)
 await assert.rejects(()=>db.query('SELECT * FROM branch_customer_service_settings'),/permission denied/)
 await db.exec('RESET ROLE')
 await db.exec('SET ROLE anon')
 await assert.rejects(()=>db.query('SELECT * FROM customer_service_settings'),/permission denied/)
 await login(admin)
 await db.query("UPDATE customer_service_settings SET whatsapp_number='' WHERE singleton")
 await db.exec('RESET ROLE')
 await db.exec(readFileSync('supabase/branch-migrations/0005_shared_customer_service.sql','utf8'))
 assert.equal((await db.query('SELECT whatsapp_number FROM customer_service_settings')).rows[0].whatsapp_number,'')
})

test('branch paper width persists, remains isolated, and survives upgrade reruns',async()=>{
 await login(admin)
 const paperId='eeeeeeee-0000-4000-8000-000000000003'
 await mutate('create',{...input,productionType:'Sublim',paperWidth:'1.8',branchId:salatiga},null,paperId)
 assert.equal(Number((await db.query('SELECT paper_width FROM orders WHERE id=$1',[paperId])).rows[0].paper_width),1.8)
 await login(smgAdmin)
 assert.equal((await db.query('SELECT paper_width FROM orders WHERE id=$1',[paperId])).rows.length,0)
 await assert.rejects(()=>mutate('edit',{...input,productionType:'Sublim',paperWidth:'1.2',spkCode:'FORGED'},1,paperId),/cabang/)
 await db.exec('RESET ROLE')
 await db.exec(readFileSync('supabase/UPGRADE_BRANCHES.sql','utf8'))
 assert.equal(Number((await db.query('SELECT paper_width FROM orders WHERE id=$1',[paperId])).rows[0].paper_width),1.8)
})


test('non-DTF types store and retain paper widths on branch order edits',async()=>{
 await login(admin)
 for(const [index,type] of ['Umbul-umbul','Batik','Jersey'].entries()) {
  const id='eeeeeeee-0000-4000-8000-00000000001'+index
  const values={...input,productionType:type,paperWidth:'1.2',branchId:salatiga}
  await mutate('create',values,null,id)
  assert.equal(Number((await db.query('SELECT paper_width FROM orders WHERE id=$1',[id])).rows[0].paper_width),1.2)
  await mutate('edit',{...values,spkCode:'PAPER-'+index,paperWidth:'1.8'},1,id)
  assert.equal(Number((await db.query('SELECT paper_width FROM orders WHERE id=$1',[id])).rows[0].paper_width),1.8)
 }
})

after(async()=>{await db.close()})


test('central branch lifecycle isolates empty branches, renames, freezes and resumes complete deletion', async () => {
 const branch='aaaaaaaa-1234-4000-8000-000000000001'
 const user='aaaaaaaa-1234-4000-8000-000000000002'
 const orderId='aaaaaaaa-1234-4000-8000-000000000003'
 const photoPath=orderId+'/aaaaaaaa-1234-4000-8000-000000000004.webp'
 const unusedPath=orderId+'/aaaaaaaa-1234-4000-8000-000000000005.webp'
 const manage=async(action,name='Cabang Lifecycle')=>(await db.query('SELECT printex_manage_branch($1,$2,$3) AS result',[action,branch,name])).rows[0].result
 await login(smgAdmin)
 await assert.rejects(()=>manage('create'),/Owner Pusat/)
 await login(admin)
 const before=(await db.query('SELECT id FROM orders ORDER BY id')).rows
 await manage('create')
 await manage('create') // retry after lost response
 assert.equal((await db.query('SELECT * FROM orders WHERE branch_id=$1',[branch])).rows.length,0)
 assert.equal((await db.query('SELECT * FROM branch_stock_shortcuts WHERE branch_id=$1',[branch])).rows.length,2)
 await manage('rename','Cabang Lifecycle Ganti')
 await db.exec('RESET ROLE')
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'new-branch@test.local')",[user])
 await db.query("UPDATE profiles SET role='owner',is_active=true,branch_id=$2 WHERE id=$1",[user,branch])
 await login(user)
 await mutate('create',{...input,branchId:branch},null,orderId)
 await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-photos',$1),('order-photos',$2)",[photoPath,unusedPath])
 await db.query('SELECT printex_set_order_photo($1,1,$2)',[orderId,photoPath])
 await login(smgAdmin)
 assert.equal((await db.query('SELECT * FROM orders WHERE id=$1',[orderId])).rows.length,0)
 assert.equal((await db.query('SELECT * FROM storage.objects WHERE name=$1',[photoPath])).rows.length,0)
 await login(admin)
 await assert.rejects(()=>manage('prepare_delete','wrong'),/konfirmasi/)
 const job=await manage('prepare_delete','Cabang Lifecycle Ganti')
 assert.deepEqual([...job.photo_paths].sort(),[photoPath,unusedPath].sort())
 assert.deepEqual(job.user_ids,[user])
 assert.deepEqual(await manage('prepare_delete','Cabang Lifecycle Ganti'),job)
 assert.equal((await manage('list')).find(b=>b.id===branch).deleting,true)
 await assert.rejects(()=>manage('finish_delete','Cabang Lifecycle Ganti'),/File/)
 await assert.rejects(()=>mutate('create',{...input,branchId:branch},null,'aaaaaaaa-1234-4000-8000-000000000006'),/cabang/)
 await db.exec('RESET ROLE')
 // Model successful Storage/Auth API deletion; never use SQL deletion of storage in production.
 await db.query('DELETE FROM storage.objects WHERE name=ANY($1)',[[photoPath,unusedPath]])
 await login(admin)
 await assert.rejects(()=>manage('finish_delete','Cabang Lifecycle Ganti'),/Akun/)
 await db.exec('RESET ROLE')
 await db.query('DELETE FROM auth.users WHERE id=$1',[user])
 await login(admin)
 await manage('finish_delete','Cabang Lifecycle Ganti')
 await manage('finish_delete','Cabang Lifecycle Ganti')
 assert.equal((await manage('list')).some(b=>b.id===branch),false)
 assert.deepEqual((await db.query('SELECT id FROM orders ORDER BY id')).rows,before)
 await db.exec('RESET ROLE')
 for(const table of ['customers','process_history','order_photo_cleanup','branch_stock_shortcuts','branch_deletions']) assert.equal((await db.query(`SELECT * FROM ${table} WHERE branch_id=$1`,[branch])).rows.length,0,table)
})


test('reapplying the upgrade never resurrects a deleted default branch', async () => {
 await login(admin)
 const archived=(await db.query('SELECT * FROM orders WHERE id=$1',[smgOrder])).rows[0]
 assert.ok(archived.archived_at)
 await assert.rejects(()=>mutate('delete',{},archived.version,smgOrder),/arsip|archiv/i)
 const job=(await db.query("SELECT printex_manage_branch('prepare_delete',$1,'Semarang') AS job",[semarang])).rows[0].job
 await db.exec('RESET ROLE')
 await db.query("DELETE FROM storage.objects WHERE bucket_id='order-photos' AND name=ANY($1)",[job.photo_paths])
 await db.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[job.user_ids])
 await login(admin)
 await db.query("SELECT printex_manage_branch('finish_delete',$1,'Semarang')",[semarang])
 await db.exec('RESET ROLE')
 await db.exec(readFileSync('supabase/UPGRADE_BRANCHES.sql','utf8'))
 assert.equal((await db.query('SELECT id FROM branches WHERE id=$1',[semarang])).rows.length,0)
 assert.equal((await db.query('SELECT id FROM branches WHERE id=$1',[salatiga])).rows.length,1)
})
