// Authorized destructive operational reset. Accounts, branches and settings are preserved.
// node --env-file=.env.local scripts/execute-demo-month.mjs --execute
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {validateDemoMonth} from './lib/validate-demo-month.mjs'

if(!process.argv.includes('--execute'))throw Error('Explicit --execute required')
const {Client,types}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
types.setTypeParser(1082,value=>value) // DATE is a calendar value, never shift it through UTC.
const apiUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,dbUrl=new URL(process.env.SUPABASE_DB_URL)
const ref=new URL(apiUrl).hostname.split('.')[0]
if(!(dbUrl.hostname===`db.${ref}.supabase.co`||(dbUrl.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(dbUrl.username).endsWith(`.${ref}`))))throw Error('Project mismatch')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const api=createClient(apiUrl,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const tables=['orders','customers','process_history','order_step_events','order_activities','schedule_items','production_schedules','order_photo_cleanup']
const protectedTables=['auth.users','public.profiles','public.branches','public.production_steps','public.machines','public.customer_service_settings','public.stock_shortcuts','public.branch_stock_shortcuts']
async function protectedHashes(){const result={};for(const table of protectedTables)result[table]=(await db.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`)).rows[0].hash;return result}
let committed=false
const backup=`build/backups/printex-before-demo-month-${new Date().toISOString().replace(/[:.]/g,'-')}`
try {
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
 await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='600s'")
 await db.query('LOCK TABLE orders,customers,process_history,order_step_events,order_activities,schedule_items,production_schedules IN ACCESS EXCLUSIVE MODE')
 const protectedBefore=await protectedHashes()
 mkdirSync(backup,{recursive:true})
 const manifest={createdAt:new Date().toISOString(),tables:{},photos:[]}
 for(const table of tables){
  const rows=(await db.query(`SELECT row_to_json(t) AS record FROM public.${table} t`)).rows.map(row=>row.record)
  const data=JSON.stringify(rows);writeFileSync(`${backup}/${table}.json`,data,{mode:0o600})
  manifest.tables[table]={rows:rows.length,sha256:createHash('sha256').update(data).digest('hex')}
 }
 const photos=(await db.query("SELECT name FROM storage.objects WHERE bucket_id='order-photos'")).rows.map(r=>r.name)
 for(const [i,path] of photos.entries()){
  const {data,error}=await api.storage.from('order-photos').download(path);if(error)throw Error('Photo backup failed')
  const file=`photo-${i}.bin`,bytes=Buffer.from(await data.arrayBuffer());writeFileSync(`${backup}/${file}`,bytes,{mode:0o600})
  manifest.photos.push({path,file,sha256:createHash('sha256').update(bytes).digest('hex')})
 }
 writeFileSync(`${backup}/manifest.json`,JSON.stringify(manifest,null,2),{mode:0o600})
 console.log(JSON.stringify({backup,previousOrders:manifest.tables.orders.rows,previousPhotos:photos.length}))
 await db.query(readFileSync('supabase/RESET_DEMO_MONTH.sql','utf8'))
 for(const table of ['orders','customers','process_history']){
  const ids=JSON.parse(readFileSync(`${backup}/${table}.json`,'utf8')).map(row=>row.id)
  const removed=(await db.query('SELECT count(DISTINCT row_id)::int AS n FROM printex_row_changes WHERE table_name=$1 AND row_id=ANY($2::uuid[]) AND deleted',[table,ids])).rows[0].n
  if(removed!==ids.length)throw Error('Missing deletion markers; refusing commit')
 }
 const report=await validateDemoMonth(db)
 if(JSON.stringify(await protectedHashes())!==JSON.stringify(protectedBefore))throw Error('Protected data changed; refusing commit')
 await db.query('COMMIT');committed=true
 writeFileSync(`${backup}/simulation-report.json`,JSON.stringify(report,null,2))
 writeFileSync('build/demo-month-report.json',JSON.stringify(report,null,2))
 for(let i=0;i<photos.length;i+=100){
  const paths=photos.slice(i,i+100)
  const linked=(await db.query('SELECT photo_path FROM orders WHERE photo_path=ANY($1::text[])',[paths])).rows.map(r=>r.photo_path)
  const {error}=await api.storage.from('order-photos').remove(paths.filter(path=>!linked.includes(path)))
  if(error)throw Error('Old photo cleanup failed; reset already committed')
 }
 console.log(JSON.stringify({committed,protectedDataPreserved:true,report}))
}catch(error){if(!committed)await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({committed,errorCode:error.code??'RESET_FAILED',message:/password|postgres(?:ql)?:\/\//i.test(error.message)?'Connection failed':error.message}));process.exitCode=1}finally{await db.end()}
