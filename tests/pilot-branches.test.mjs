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

test('scoped snapshot respects branch RLS for forged branch and detail parameters',async()=>{
 await db.exec('RESET ROLE')
 await db.exec(readFileSync('supabase/migrations/0026_cached_branch_reads.sql','utf8'))
 await login(admin)
 const snapshot=async(branch=null,detail=null)=>(await db.query("SELECT printex_scoped_snapshot('2026-10-01','2026-10-01',$1,$2) AS data",[branch,detail])).rows[0].data
 const central=await snapshot()
 assert.equal(central.orders.length,2)
 assert.ok((await snapshot(salatiga)).orders.every(row=>row.branch_id===salatiga))
 await login(smgAdmin)
 const local=await snapshot()
 assert.equal(local.orders.length,1)
 assert.ok(local.orders.every(row=>row.branch_id===semarang))
 assert.ok(local.process_history.every(row=>row.branch_id===semarang))
 const forged=await snapshot(salatiga,id)
 assert.equal(forged.orders.length,0)
 assert.equal(forged.customers.length,0)
 assert.equal(forged.process_history.length,0)
 const forgedPage=(await db.query("SELECT printex_scoped_snapshot('2026-10-01','2026-10-01',NULL,NULL,NULL,NULL,true,$1) AS data",[[id]])).rows[0].data
 assert.equal(forgedPage.process_history.length,0,'Explicit continuation identities cannot bypass branch RLS')
 await db.exec('RESET ROLE; SET ROLE anon')
 await assert.rejects(()=>snapshot(),/permission denied/)
 await login(admin)
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

test('report read indexes install repeatedly without changing reports or business rows',async()=>{
 await db.exec('RESET ROLE')
 const read=async()=>({
  orders:(await db.query('SELECT id,version FROM orders ORDER BY id')).rows,
  summaries:(await db.query('SELECT * FROM report_daily_summaries ORDER BY branch_id,report_date,metric,dimension')).rows,
  queue:(await db.query('SELECT * FROM report_refresh_queue ORDER BY order_id')).rows,
 })
 const before=await read()
 const sql=readFileSync('supabase/report-migrations/0003_report_read_indexes.sql','utf8')
 await db.exec(sql);await db.exec(sql)
 assert.deepEqual(await read(),before)
 const indexes=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('report_queue_oldest','report_queue_branch_oldest','report_details_branch_page','report_details_all_page')")).rows
 assert.equal(indexes.length,4)
 assert.ok(indexes.filter(row=>row.indexname.startsWith('report_details')).every(row=>row.indexdef.includes('report_date DESC')))
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


test('daily summaries persist totals, revise only changed orders and isolate branches',async()=>{
 await login(admin)
 const reportId='11111111-0000-4000-8000-000000000099'
 await mutate('create',{...input,branchId:salatiga,spkCode:'SUMMARY-TEST'},null,reportId)
 await db.exec('RESET ROLE')
 await db.query('SELECT printex_refresh_report_queue(500)')
 await login(admin)
 const read=async()=> (await db.query("SELECT printex_daily_report('2026-09-07','2026-09-07',$1) AS data",[salatiga])).rows[0].data
 const first=await read()
 assert.equal(first.pending,false)
 assert.ok(first.rows.find(r=>r.metric==='intake')?.count>0)
 const second=await read()
 assert.deepEqual(second.rows,first.rows)
 await assert.rejects(()=>db.query('SELECT * FROM report_daily_summaries'),/permission denied/)
 await assert.rejects(()=>db.query('SELECT printex_refresh_report_queue(100)'),/permission denied/)
 const version=(await db.query('SELECT version FROM orders WHERE id=$1',[reportId])).rows[0].version
 await mutate('edit',{...input,spkCode:'SUMMARY-TEST',orderDate:'2026-09-08'},version,reportId)
 const third=await read()
 assert.equal(third.rows.find(r=>r.metric==='intake').count,first.rows.find(r=>r.metric==='intake').count-1)
 const forged=(await db.query("SELECT printex_daily_report('2026-09-01','2026-09-30',$1) AS data",[semarang])).rows[0].data
 assert.equal(forged.rows.length,0)
 await db.exec('RESET ROLE')
})


test('saved production freezes at Done, keeps print day and revises totals without duplicates',async()=>{
 await login(admin)
 const oid='11111111-0000-4000-8000-000000000098'
 await mutate('create',{...input,productionType:'Batik',paperWidth:'1.2',meter:100,orderDate:'2026-09-01',branchId:salatiga,spkCode:'SAVED-TIMING'},null,oid)
 const row=async()=> (await db.query('SELECT * FROM orders WHERE id=$1',[oid])).rows[0]
 for(const code of ['DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE'])await mutate('move',{code},(await row()).version,oid)
 await db.exec('RESET ROLE')
 await db.query(`UPDATE process_history h SET occurred_at=CASE
  WHEN s.code='ORDER_IN' AND h.event_kind='entered' THEN '2026-09-01T00:00:00Z'::timestamptz
  WHEN s.code='ORDER_IN' THEN '2026-09-01T01:00:00Z'::timestamptz
  WHEN s.code='DESIGN' THEN '2026-09-01T02:00:00Z'::timestamptz
  WHEN s.code='DESIGN_DONE' THEN '2026-09-01T03:00:00Z'::timestamptz
  WHEN s.code='PRINTING' THEN '2026-09-02T03:00:00Z'::timestamptz
  WHEN s.code='PRESS' THEN '2026-09-02T04:00:00Z'::timestamptz END
 FROM production_steps s WHERE s.id=h.step_id AND h.order_identity=$1`,[oid])
 await db.query('SELECT printex_refresh_report_queue(500)')
 await login(admin)
 const read=async()=> (await db.query("SELECT printex_daily_report('2026-09-02','2026-09-02',$1) AS data",[salatiga])).rows[0].data
 const first=await read()
 assert.equal(first.rows.find(r=>r.metric==='output'&&r.dimension==='sublim').meter,100)
 assert.equal(first.rows.find(r=>r.metric==='productivity'&&r.dimension==='sublim:1.2').milliseconds,86400000)
 assert.equal(first.rows.find(r=>r.metric==='production').milliseconds,27*3600000)
 await mutate('edit',{...input,spkCode:'SAVED-TIMING',productionType:'Batik',paperWidth:'1.2',meter:150,orderDate:'2026-09-01'},(await row()).version,oid)
 const edited=await read()
 assert.equal(edited.rows.find(r=>r.metric==='output'&&r.dimension==='sublim').meter,150)
 assert.equal(edited.rows.find(r=>r.metric==='output'&&r.dimension==='sublim').count,1)
 await mutate('archive',{deliveryMethod:'received'},(await row()).version,oid)
 const archived=await read()
 assert.equal(archived.rows.find(r=>r.metric==='production').milliseconds,27*3600000)
 const details=(await db.query("SELECT printex_report_details('2026-09-02','2026-09-02','production','',$1) AS data",[salatiga])).rows[0].data
 assert.equal(details.items[0].order.spk_code,'SAVED-TIMING')
 assert.equal(details.items[0].productionMilliseconds,27*3600000)
 await db.exec('RESET ROLE')
})

test('branch deletion cascades saved summaries without recreating deleted branch metrics',async()=>{
 await db.exec('RESET ROLE')
 const bid='11111111-0000-4000-8000-000000000097'
 const oid='11111111-0000-4000-8000-000000000096'
 await db.query("INSERT INTO branches(id,name) VALUES($1,'Summary Delete Test')",[bid])
 await db.query("SELECT printex_report_add($1,$2,'2026-09-01','process','DESIGN',0,0,'{}')",[oid,bid])
 await login(admin)
 await db.query("SELECT printex_manage_branch('prepare_delete',$1,'Summary Delete Test')",[bid])
 await db.query("SELECT printex_manage_branch('finish_delete',$1,'Summary Delete Test')",[bid])
 await db.exec('RESET ROLE')
 assert.equal((await db.query('SELECT * FROM report_daily_summaries WHERE branch_id=$1',[bid])).rows.length,0)
 assert.equal((await db.query('SELECT * FROM report_contributions WHERE branch_id=$1',[bid])).rows.length,0)
})

test('storage compaction preserves history, report JSON, totals, corrections and access',async()=>{
 await db.exec('BEGIN; RESET ROLE')
 try {
  const oid='11111111-0000-4000-8000-000000000095'
  await login(admin)
  await mutate('create',{...input,branchId:salatiga,spkCode:'COMPACT-REGRESSION',orderDate:'2026-11-01'},null,oid)
  const row=async()=> (await db.query('SELECT * FROM orders WHERE id=$1',[oid])).rows[0]
  for(const code of ['DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE'])await mutate('move',{code},(await row()).version,oid)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1 AND (actor_id IS NOT NULL OR actor_name IS NOT NULL OR assigned_employee_id IS NOT NULL)',[oid])).rows[0].n,0)
  await db.query('UPDATE orders SET assigned_designer_id=$2 WHERE id=$1',[oid,admin])
  // Model the old two-row transition format, including a conflicting actor.
  const exits=(await db.query('SELECT * FROM process_history WHERE order_id=$1 AND next_step_id IS NOT NULL',[oid])).rows
  await db.exec('ALTER TABLE process_history DISABLE TRIGGER history_no_actor')
  for(const h of exits){
   await db.query(`INSERT INTO process_history(id,order_id,spk_code,step_id,event_kind,occurred_at,customer_name,actor_id,actor_name)
    VALUES($1,$2,$3,$4,'entered',$5,$6,$7,'Old Actor')`,[h.next_event_id,oid,h.spk_code,h.next_step_id,h.occurred_at,h.customer_name,admin])
  }
  await db.query('UPDATE process_history SET next_step_id=NULL,next_event_id=NULL,actor_name=$2,actor_id=$3 WHERE order_id=$1',[oid,'Old Actor',admin])
  await db.exec('ALTER TABLE process_history ENABLE TRIGGER history_no_actor')
  await db.query(`UPDATE process_history h SET occurred_at='2026-11-01T00:00:00Z'::timestamptz+s.sequence*interval '1 hour'
   FROM production_steps s WHERE s.id=h.step_id AND h.order_id=$1 AND h.event_kind<>'entered'`,[oid])
  // Move each entry back to the matching exit time.
  for(const h of exits)await db.query('UPDATE process_history SET occurred_at=(SELECT occurred_at FROM process_history WHERE id=$2) WHERE id=$1',[h.next_event_id,h.id])
  await db.query("UPDATE process_history SET occurred_at='2026-11-01T00:00:00Z' WHERE order_id=$1 AND step_id=(SELECT id FROM production_steps WHERE code='ORDER_IN') AND event_kind='entered'",[oid])
  await db.exec('ALTER TABLE process_history DISABLE TRIGGER history_no_actor')
  await db.query('UPDATE process_history SET actor_name=$2,actor_id=$3,assigned_employee_id=$3 WHERE order_id=$1',[oid,'Old Actor',admin])
  await db.exec('ALTER TABLE process_history ENABLE TRIGGER history_no_actor')
  await db.exec(readFileSync('supabase/report-migrations/0001_daily_summaries.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''))
  await db.exec('ALTER TABLE report_contributions DISABLE TRIGGER report_compact_payload')
  await db.query('SELECT printex_refresh_report_order($1)',[oid])
  await db.exec('ALTER TABLE report_contributions ENABLE TRIGGER report_compact_payload')
  const summary=async()=> (await db.query('SELECT * FROM report_daily_summaries ORDER BY branch_id,report_date,metric,dimension')).rows
  const beforeSummary=await summary()
  const logical=async()=> (await db.query(`SELECT id,step_id,event_kind,occurred_at FROM process_history WHERE order_id=$1
   UNION ALL SELECT next_event_id,next_step_id,'entered',occurred_at FROM process_history WHERE order_id=$1 AND next_step_id IS NOT NULL ORDER BY id`,[oid])).rows
  const beforeHistory=await logical()
  const read=async()=>{
   const values=[]
   for(const [metric,dimension] of [['production',''],['timing','DESIGN'],['timing','PRINTING'],['process','PRINTING']]){
    values.push((await db.query("SELECT printex_report_details('2026-11-01','2026-11-01',$1,$2,$3,0,50,'COMPACT-REGRESSION') AS data",[metric,dimension,salatiga])).rows[0].data)
   }
   return values
  }
  const before=await read()
  assert.ok(before.every(r=>r.total===1))
  assert.equal(before[3].items[0].event.actorName,'Old Actor')
  before[3].items[0].event.actorName=null
  const cursor=(await db.query('SELECT revision FROM printex_sync_clock WHERE singleton')).rows[0].revision
  const beforeQueue=(await db.query('SELECT * FROM report_refresh_queue ORDER BY order_id')).rows
  await db.exec(readFileSync('supabase/maintenance/begin-history-compaction.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/0030_history_without_actors.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''))
  await db.exec(readFileSync('supabase/maintenance/compact-history.sql','utf8'))
  await db.exec(readFileSync('supabase/maintenance/end-history-compaction.sql','utf8'))
  await db.exec(readFileSync('supabase/report-migrations/0002_compact_payloads.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''))
  assert.deepEqual((await db.query('SELECT * FROM report_refresh_queue ORDER BY order_id')).rows,beforeQueue,'No redundant report refresh is enqueued')
  const delta=(await db.query('SELECT printex_sync_changes($1,$2) AS data',[cursor,salatiga])).rows[0].data
  assert.ok(delta.changes.some(r=>r.table==='process_history'&&r.id===exits[0].id))
  assert.ok(delta.changes.some(r=>r.table==='process_history'&&r.id===exits[0].next_event_id))
  assert.equal((await db.query("SELECT deleted FROM printex_row_changes WHERE table_name='process_history' AND row_id=$1",[exits[0].next_event_id])).rows[0].deleted,true)
  assert.equal(Number(delta.cursor),Number(cursor)+1,'Bulk maintenance advances the cursor once')
  assert.deepEqual(await logical(),beforeHistory)
  assert.equal((await row()).assigned_designer_id,admin,'Order assignment remains available')
  assert.deepEqual(await summary(),beforeSummary)
  assert.deepEqual(await read(),before)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM process_history WHERE actor_id IS NOT NULL OR actor_name IS NOT NULL OR assigned_employee_id IS NOT NULL")).rows[0].n,0)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM report_contributions WHERE data->'order'<>'null'::jsonb")).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM report_order_payloads WHERE order_id=$1',[oid])).rows[0].n,1)
  await db.query('UPDATE process_history SET actor_id=$2,actor_name=$3,assigned_employee_id=$2 WHERE order_id=$1',[oid,admin,'Imported Actor'])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM process_history WHERE order_id=$1 AND (actor_id IS NOT NULL OR actor_name IS NOT NULL OR assigned_employee_id IS NOT NULL)',[oid])).rows[0].n,0,'Imports cannot restore actor metadata')
  await db.exec('SAVEPOINT conflicting_snapshot')
  await db.exec('ALTER TABLE report_contributions DISABLE TRIGGER report_compact_payload')
  await db.query("UPDATE report_contributions SET data=jsonb_set(data,'{order}',jsonb_build_object('spk_code',metric||dimension)) WHERE order_id=$1 AND data ? 'order'",[oid])
  await db.exec('ALTER TABLE report_contributions ENABLE TRIGGER report_compact_payload')
  await assert.rejects(()=>db.exec(readFileSync('supabase/report-migrations/0002_compact_payloads.sql','utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')),/Conflicting report snapshots/)
  await db.exec('ROLLBACK TO SAVEPOINT conflicting_snapshot; RELEASE SAVEPOINT conflicting_snapshot')
  await db.query('SELECT printex_refresh_report_order($1)',[oid])
  assert.deepEqual(await read(),before,'Recalculation uses the same compact payload format')
  await login(admin)
  await db.exec('SAVEPOINT denied_payload')
  await assert.rejects(()=>db.query('SELECT * FROM report_order_payloads'),/permission denied/)
  await db.exec('ROLLBACK TO SAVEPOINT denied_payload; RELEASE SAVEPOINT denied_payload')
  await db.exec('SAVEPOINT denied_expanded')
  await assert.rejects(()=>db.query('SELECT * FROM printex_report_expanded'),/permission denied/)
  await db.exec('ROLLBACK TO SAVEPOINT denied_expanded; RELEASE SAVEPOINT denied_expanded')
  await mutate('edit',{...input,branchId:salatiga,spkCode:'COMPACT-CORRECTED',orderDate:'2026-11-01'},(await row()).version,oid)
  await db.exec('RESET ROLE')
  await db.query('SELECT printex_refresh_report_order($1)',[oid])
  assert.equal((await read())[0].total,0,'Old search text is not retained in duplicate snapshots')
  assert.equal((await db.query('SELECT data FROM report_order_payloads WHERE order_id=$1',[oid])).rows[0].data.spk_code,'COMPACT-CORRECTED')
 } finally {await db.exec('ROLLBACK; RESET ROLE')}
})
