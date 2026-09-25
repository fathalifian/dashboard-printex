'use client'

import { useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PROCESS_STAGES, type ProcessEvent } from '@/lib/process-metrics'
import { ACCESS_SCHEMA_VERSION, canManageOrders, canMoveBetweenStages, normalizeRole } from '@/lib/access-control'
import { ORDER_PHOTO_BUCKET, compressOrderPhoto } from '@/lib/order-photo'

export type BoardStageId = typeof PROCESS_STAGES[number]
export type DeliveryMethod = 'pickup' | 'delivery'
export const BOARD_STAGE_META: Record<BoardStageId, {code:string;name:string;color:string;orderState:string}> = {
  incoming:{code:'ORDER_IN',name:'Order Masuk',color:'slate',orderState:'active'},
  design:{code:'DESIGN',name:'Proses Desain',color:'red',orderState:'active'},
  design_done:{code:'DESIGN_DONE',name:'Menunggu Pembayaran',color:'blue',orderState:'active'},
  printing:{code:'PRINTING',name:'Proses Sublim',color:'amber',orderState:'active'},
  press:{code:'PRESS',name:'Proses Press',color:'violet',orderState:'active'},
  done:{code:'DONE',name:'Order Selesai',color:'emerald',orderState:'completed'},
  archive:{code:'ARCHIVE',name:'Order Diterima Customer',color:'slate',orderState:'completed'},
}
export type OrderEditInput = {spkCode:string;customerName:string;productionType:string;meter:number;customerType:string;orderDate:string;dueDate:string;notes:string}
export type NewOrderInput = Omit<OrderEditInput,'spkCode'>
export type BoardOrder = {
  id:string;spk_code:string;customer:{name:string;phone:string};production_type:string;meter:number;customer_type:string;
  order_state:string;current_step:{code:string;name:string};order_date:string;due_at:string;notes:string;created_at:string;
  board_stage:BoardStageId;color_token:string;version:number;photo_path:string|null;archive:{archivedAt:string;deliveryMethod:DeliveryMethod;finalizedAt?:string}|null
}
type Connection = {state:'loading'|'ready'|'error';realtime:boolean;busy:boolean;error:string;profile:{id:string;full_name:string;role:string}|null}
const INITIAL_CONNECTION: Connection = {state:'loading',realtime:false,busy:false,error:'',profile:null}
const EMPTY_ORDERS: BoardOrder[] = []
const EMPTY_HISTORY: ProcessEvent[] = []
let orders = EMPTY_ORDERS, active = EMPTY_ORDERS, production = EMPTY_ORDERS
let history = EMPTY_HISTORY
let connection = INITIAL_CONNECTION
let started = false
let client: ReturnType<typeof createClient> | undefined
let fetching: Promise<void> | undefined
let refreshAgain = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let lastPhotoCleanup = 0
let photoCleanupRunning = false
const listeners = new Set<() => void>()
function emit() { listeners.forEach(listener => listener()) }
function setConnection(update: Partial<Connection>) { connection = {...connection,...update}; emit() }
function db() { return client ??= createClient() }
export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'Tidak dapat terhubung ke server. Periksa jaringan dan coba lagi.'
}
async function allRows(table: string) {
  const rows: Record<string, unknown>[] = []
  for (let offset=0;;offset+=1000) {
    const {data,error} = await db().from(table).select('*').order('id').range(offset,offset+999)
    if (error) throw error
    rows.push(...data)
    if(data.length<1000) return rows
  }
}
async function fetchSnapshot() {
  const {data:profile,error:profileError}=await db().from('profiles').select('id,full_name,role,is_active').eq('id',connection.profile?.id??'').maybeSingle()
  if(profileError)throw profileError
  if(!profile?.is_active)throw new Error('Akses akun sudah dinonaktifkan. Hubungi admin.')
  const role = normalizeRole(profile.role)
  if (!role) throw new Error('Role akun tidak valid. Hubungi Owner.')
  const [orderRows,customers,steps,eventRows] = await Promise.all(['orders','customers','production_steps','process_history'].map(allRows))
  const stepMap = new Map(steps.map(step => [step.id,step]))
  const customerMap = new Map(customers.map(customer => [customer.id,customer]))
  if(PROCESS_STAGES.some(stage => !steps.some(step=>step.code===BOARD_STAGE_META[stage].code))) throw new Error('Tahapan produksi belum lengkap. Jalankan SETUP_ONLINE.sql.')
  const stageFromStep = (id: unknown): BoardStageId => {
    const found = PROCESS_STAGES.find(stage=>BOARD_STAGE_META[stage].code===stepMap.get(id)?.code)
    if(!found) throw new Error('Ada order/riwayat dengan tahap tidak valid. Periksa database.')
    return found
  }
  const nextOrders: BoardOrder[] = orderRows.map(row=>{
    const stage=stageFromStep(row.current_step_id), meta=BOARD_STAGE_META[stage], customer=customerMap.get(row.customer_id)
    return {id:String(row.id),spk_code:String(row.spk_code),customer:{name:String(customer?.name??''),phone:String(customer?.phone??'')},
      production_type:String(row.production_type),meter:Number(row.meter),customer_type:String(row.customer_type),order_state:meta.orderState,
      current_step:{code:meta.code,name:meta.name},board_stage:stage,color_token:meta.color,order_date:String(row.order_date),due_at:String(row.due_at??''),
      notes:String(row.notes??''),created_at:String(row.created_at),version:Number(row.version),photo_path:row.photo_path?String(row.photo_path):null,
      archive:row.archived_at?{archivedAt:String(row.archived_at),deliveryMethod:row.delivery_method as DeliveryMethod,finalizedAt:row.archive_finalized_at?String(row.archive_finalized_at):undefined}:null}
  })
  const nextHistory: ProcessEvent[] = eventRows.map(row=>({id:String(row.id),orderId:String(row.order_identity??row.order_id),spkCode:String(row.spk_code),customerName:String(row.customer_name??''),
    stage:stageFromStep(row.step_id),kind:row.event_kind as ProcessEvent['kind'],occurredAt:String(row.occurred_at),actorName:row.actor_name?String(row.actor_name):null}))
  orders=nextOrders;active=orders.filter(order=>order.board_stage!=='archive');production=orders.filter(order=>!order.archive?.finalizedAt);history=nextHistory
  setConnection({state:'ready',error:'',profile:{...profile,role}})
  if (canManageOrders(role) && !photoCleanupRunning && Date.now() - lastPhotoCleanup > 5 * 60 * 1000) {
    lastPhotoCleanup = Date.now(); photoCleanupRunning = true
    void cleanupOrderPhotos().catch(() => {}).finally(() => { photoCleanupRunning = false })
  }
}
export async function refreshOnlineData() {
  // An explicit refresh also covers notifications still waiting in the batch.
  if (refreshTimer !== undefined) { clearTimeout(refreshTimer); refreshTimer = undefined }
  if(fetching) { refreshAgain=true; return fetching }
  fetching=(async()=>{do {refreshAgain=false;await fetchSnapshot()}while(refreshAgain)})()
  try {await fetching} catch(error) {setConnection({state:'error',error:errorMessage(error)});throw error} finally {fetching=undefined}
}
function scheduleRefresh() {
  // One transaction can update orders, customers and several history rows.
  // Collect these notifications instead of fetching a full snapshot per row.
  if (refreshTimer !== undefined) return
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    void refreshOnlineData().catch(() => {})
  }, 300)
}
async function start() {
  try {
    const {data:{user},error}=await db().auth.getUser()
    if(error||!user) throw new Error('Silakan login untuk membuka data online.')
    const {data:profile,error:profileError}=await db().from('profiles').select('id,full_name,role,is_active').eq('id',user.id).maybeSingle()
    if(profileError) throw profileError
    if(!profile?.is_active) throw new Error('Akun belum diaktifkan sebagai karyawan. Hubungi admin.')
    const role = normalizeRole(profile.role)
    if (!role) throw new Error('Role akun tidak valid. Hubungi Owner.')
    setConnection({profile:{...profile,role}})
    const {data:ready,error:setupError}=await db().rpc('printex_online_status')
    if(setupError||ready?.schema_version!==ACCESS_SCHEMA_VERSION) throw new Error('Hak akses database belum diperbarui. Jalankan migrasi 0013_owner_operator_permissions.sql di Supabase SQL Editor.')
    const requiredTables=['orders','customers','production_steps','process_history','profiles']
    if(requiredTables.some(table=>!ready.realtime_tables?.includes(table))) throw new Error('Realtime belum diaktifkan untuk seluruh tabel.')
    await refreshOnlineData()
    const channel=db().channel(`printex-board-${crypto.randomUUID()}`)
    for(const table of requiredTables) channel.on('postgres_changes',{event:'*',schema:'public',table},scheduleRefresh)
    channel.subscribe(status=>{
      setConnection({realtime:status==='SUBSCRIBED'})
      if(status==='SUBSCRIBED') void refreshOnlineData().catch(()=>{})
    })
    window.addEventListener('online',()=>{void refreshOnlineData().catch(()=>{})})
    window.addEventListener('offline',()=>setConnection({state:'error',realtime:false,error:'Koneksi terputus. Perubahan dinonaktifkan sampai terhubung kembali.'}))
    window.addEventListener('focus',()=>{void refreshOnlineData().catch(()=>{})})
    window.setInterval(()=>{if(document.visibilityState==='visible') void refreshOnlineData().catch(()=>{})},30000)
  } catch(error) {setConnection({state:'error',error:errorMessage(error)})}
}
function subscribe(listener:()=>void) {listeners.add(listener);if(!started){started=true;void start()}return()=>{listeners.delete(listener)}}
export function useAllOrders(){return useSyncExternalStore(subscribe,()=>orders,()=>EMPTY_ORDERS)}
export function useBoardOrders(){return useSyncExternalStore(subscribe,()=>active,()=>EMPTY_ORDERS)}
export function useProductionOrders(){return useSyncExternalStore(subscribe,()=>production,()=>EMPTY_ORDERS)}
export function useProcessHistory(){return useSyncExternalStore(subscribe,()=>history,()=>EMPTY_HISTORY)}
export function useOnlineConnection(){return useSyncExternalStore(subscribe,()=>connection,()=>INITIAL_CONNECTION)}

async function mutate(action:string,id:string,data:unknown={}) {
  if(connection.state!=='ready'||connection.busy) throw new Error('Tunggu sinkronisasi selesai sebelum mengubah order.')
  const order=orders.find(item=>item.id===id)
  if (!canManageOrders(connection.profile?.role)) {
    const code = data && typeof data === 'object' && 'code' in data ? data.code : null
    const target = PROCESS_STAGES.find(stage => BOARD_STAGE_META[stage].code === code)
    if (action !== 'move' || !order || !target || !canMoveBetweenStages(connection.profile?.role, order.board_stage, target)) {
      throw new Error('Operator hanya dapat memindahkan order di area Menunggu Pembayaran, Sublim, Press, dan Order Selesai.')
    }
  }
  setConnection({busy:true,error:''})
  try {
    const {error}=await db().rpc('printex_mutate_order',{p_action:action,p_order_id:id,p_expected_version:order?.version??null,p_data:data})
    if(error) throw error
    if (action === 'delete' && order?.photo_path) await cleanupOrderPhotos(order.photo_path).catch(() => {})
    await refreshOnlineData()
  } catch(error) {setConnection({error:errorMessage(error)});throw error} finally {setConnection({busy:false})}
}
export async function addOrder(input:NewOrderInput,id=crypto.randomUUID()){await mutate('create',id,input);return orders.find(order=>order.id===id)}
export async function updateOrder(id:string,input:OrderEditInput){await mutate('edit',id,input)}
export async function deleteOrder(id:string){await mutate('delete',id)}
export function canMoveOrder(from:BoardStageId,to:BoardStageId,productionType:string){
  if(from==='archive'||to==='archive'||from===to)return false
  return Math.abs(PROCESS_STAGES.indexOf(to)-PROCESS_STAGES.indexOf(from))===1
    || (from==='incoming'&&to==='design_done')
    || (from==='printing'&&to==='done'&&productionType==='DTF')
}
export async function moveOrderToStage(id:string,stage:BoardStageId){
  const order=orders.find(item=>item.id===id)
  if(!order||order.board_stage==='archive'||stage==='archive'||!PROCESS_STAGES.includes(stage)||!canMoveBetweenStages(connection.profile?.role,order.board_stage,stage)||!canMoveOrder(order.board_stage,stage,order.production_type))return false
  await mutate('move',id,{code:BOARD_STAGE_META[stage].code});return true
}
export async function archiveOrder(id:string,deliveryMethod:DeliveryMethod){await mutate('archive',id,{deliveryMethod});return true}
export async function finishArchivedOrder(id:string){await mutate('finish',id);return true}

// The database claims only unreferenced paths and prevents attaching a claimed file.
// Failed API deletions remain queued and are retried during later online refreshes.
export async function cleanupOrderPhotos(path: string | null = null) {
  const { data, error } = await db().rpc('printex_claim_photo_cleanup', { p_path: path })
  if (error) throw error
  const paths = (data as { path: string }[] | null)?.map(row => row.path) ?? []
  if (!paths.length) return
  const result = await db().storage.from(ORDER_PHOTO_BUCKET).remove(paths)
  if (result.error) throw result.error
}

export async function saveOrderPhoto(id: string, file: File | null) {
  if (connection.state !== 'ready' || connection.busy) throw new Error('Tunggu sinkronisasi selesai sebelum mengubah foto.')
  if (!canManageOrders(connection.profile?.role)) throw new Error('Hanya Owner/Admin yang dapat mengubah foto order.')
  const order = orders.find(item => item.id === id)
  if (!order || order.board_stage === 'archive') throw new Error('Order tidak tersedia untuk perubahan foto.')
  let path: string | null = null
  const storage = db().storage.from(ORDER_PHOTO_BUCKET)
  setConnection({ busy: true })
  try {
    if (file) {
      file = await compressOrderPhoto(file)
      path = `${id}/${crypto.randomUUID()}.webp`
    }
    if (file && path) {
      const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw error
    }
    const { error } = await db().rpc('printex_set_order_photo', { p_order_id: id, p_expected_version: order.version, p_path: path })
    if (error) throw error
    // Cleanup is best-effort; the committed order must stay visible even if cleanup fails.
    if (order.photo_path && order.photo_path !== path) await cleanupOrderPhotos(order.photo_path).catch(() => {})
    await refreshOnlineData()
  } catch (error) {
    // Even after a lost RPC response, claim checks the committed reference before deletion.
    if (path) await cleanupOrderPhotos(path).catch(() => {})
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code === 'PGRST202' || /bucket not found/i.test(errorMessage(error))) {
      throw new Error('Penyimpanan foto belum aktif. Jalankan migrasi 0015_order_photos.sql di Supabase.')
    }
    throw error
  } finally { setConnection({ busy: false }) }
}
