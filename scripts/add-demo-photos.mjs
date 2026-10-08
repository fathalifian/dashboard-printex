// Add two small, clearly marked synthetic artwork samples per active branch.
import {readFileSync,existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {chromium} from 'playwright'
const {Client}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
const storage=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from('order-photos')
let browser
try {
 await db.connect()
 const orders=(await db.query(`SELECT * FROM (SELECT o.id,o.spk_code,b.name AS branch,
 row_number() OVER(PARTITION BY b.id ORDER BY o.order_date DESC,o.spk_code) AS n
 FROM orders o JOIN branches b ON b.id=o.branch_id WHERE o.source='simulation'
 AND o.spk_code ~ '^PTXID[0-9A-F]{8}$' AND o.archived_at IS NULL AND o.photo_path IS NULL AND b.is_active) selected WHERE n<=2`)).rows
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe'
 browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})})
 const page=await browser.newPage()
 let count=0,totalBytes=0
 for(const order of orders){
  const image=await page.evaluate(({spk_code,branch,n})=>{
   const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d')
   ctx.fillStyle=n===1?'#f0f4ff':'#fff4f0';ctx.fillRect(0,0,900,600)
   ctx.fillStyle=n===1?'#2255aa':'#c52535'
   for(let x=0;x<900;x+=70){ctx.beginPath();ctx.moveTo(x,260);ctx.lineTo(x+35,410);ctx.lineTo(x+70,260);ctx.closePath();ctx.fill()}
   ctx.fillStyle='#172033';ctx.font='bold 42px Arial';ctx.fillText('PRiNTEX | SIMULASI',45,75)
   ctx.font='26px Arial';ctx.fillText(branch+' - sampel desain cetak',45,130);ctx.fillText(spk_code,45,180)
   ctx.font='bold 25px Arial';ctx.fillText('DATA UJI - BUKAN PESANAN PELANGGAN',45,490)
   ctx.font='20px Arial';ctx.fillText('Untuk uji thumbnail, cache, ganti foto, dan hapus foto.',45,535)
   return canvas.toDataURL('image/png').split(',')[1]
  },{...order,n:Number(order.n)})
  const path=`${order.id}/${randomUUID()}.png`,bytes=Buffer.from(image,'base64')
  const {error}=await storage.upload(path,bytes,{contentType:'image/png',cacheControl:'3600',upsert:false});if(error)throw Error('Demo photo upload failed')
  try {
   await db.query('BEGIN');await db.query("SET LOCAL printex.importing='yes'")
   const linked=await db.query("UPDATE orders SET photo_path=$1 WHERE id=$2 AND source='simulation' AND photo_path IS NULL AND archived_at IS NULL RETURNING id",[path,order.id])
   if(linked.rowCount!==1)throw Error('Demo order changed during photo upload')
   await db.query('COMMIT');count++;totalBytes+=bytes.length
  }catch(error){await db.query('ROLLBACK');await storage.remove([path]);throw error}
 }
 console.log(JSON.stringify({demoPhotos:count,totalKB:Math.round(totalBytes/1024)}))
}catch(error){console.log(JSON.stringify({code:error.code??'DEMO_PHOTO_FAILED',message:error.message}));process.exitCode=1}finally{await browser?.close();await db.end()}
