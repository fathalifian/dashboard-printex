'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { recordRoomNavigation } from '@/lib/room-navigation'
import { createClient } from '@/lib/supabase/client'
import { jakartaDate, PROCESS_STAGES, type ProcessEvent } from '@/lib/process-metrics'
import { ACCESS_SCHEMA_VERSION, canManageOrders, canMoveBetweenStages, normalizeRole } from '@/lib/access-control'
import { ORDER_PHOTO_BUCKET, compressOrderPhoto } from '@/lib/order-photo'

export type BoardStageId = typeof PROCESS_STAGES[number]
export type DeliveryMethod = 'pickup' | 'delivery' | 'received'
export const BOARD_STAGE_META: Record<BoardStageId, {code:string;name:string;color:string;orderState:string}> = {
  incoming:{code:'ORDER_IN',name:'Order Masuk',color:'slate',orderState:'active'},
  design:{code:'DESIGN',name:'Proses Desain',color:'red',orderState:'active'},
  design_done:{code:'DESIGN_DONE',name:'Menunggu Pembayaran',color:'blue',orderState:'active'},
  printing:{code:'PRINTING',name:'Proses Sublim',color:'amber',orderState:'active'},
  press:{code:'PRESS',name:'Proses Press',color:'violet',orderState:'active'},
  done:{code:'DONE',name:'Order Selesai',color:'emerald',orderState:'completed'},
  archive:{code:'ARCHIVE',name:'Order Diterima Customer',color:'slate',orderState:'completed'},
}
export type OrderEditInput = {spkCode:string;customerName:string;customerPhone?:string;productionType:string;meter:number;paperWidth?:string|null;customerType:string;orderDate:string;dueDate:string;notes:string}
type NewOrderInput = Omit<OrderEditInput,'spkCode'> & {spkCode?:string}
export type BoardOrder = {
  id:string;branch_id?:string;spk_code:string;customer:{name:string;phone:string};production_type:string;meter:number;paper_width?:string|null;customer_type:string;
  order_state:string;current_step:{code:string;name:string};order_date:string;due_at:string;notes:string;created_at:string;
  board_stage:BoardStageId;color_token:string;version:number;photo_path:string|null;archive:{archivedAt:string;deliveryMethod:DeliveryMethod;finalizedAt?:string}|null
}
export type Branch = {id:string;name:string}
type Connection = {reportSummariesEnabled?:boolean;loadingRows?:number;dataLoading?:boolean;scopedLoading?:boolean;dataRange?:{start:string;end:string};syncMode?:'incremental'|'full';lastSyncedAt?:number;branches?:Branch[];branchId?:string|null;central?:boolean;state:'loading'|'ready'|'error';realtime:boolean;busy:boolean;error:string;profile:{id:string;full_name:string;role:string}|null}
const INITIAL_CONNECTION: Connection = {state:'loading',realtime:false,busy:false,error:'',profile:null}
const EMPTY_ORDERS: BoardOrder[] = []
const EMPTY_HISTORY: ProcessEvent[] = []
let orders = EMPTY_ORDERS, active = EMPTY_ORDERS, production = EMPTY_ORDERS
let history = EMPTY_HISTORY
let connection = INITIAL_CONNECTION
let multiBranch = false
let metadataView = false
export function selectDataView(metadata:boolean) {
  if(metadataView===metadata)return
  metadataView=metadata;branchRevision++
  if(started&&connection.profile){setConnection({dataLoading:true});void refreshOnlineData().catch(()=>{})}
}
let selectedBranch: string | null | undefined
let branchRevision = 0
const initialDay = jakartaDate(new Date())
let dataWindow = {start:initialDay,end:initialDay,orderId:null as string|null}
const requestedRanges = new Map<symbol, {start:string;end:string}>()
let rangeUpdateQueued = false
let syncCursor: string | null = null
let rowCache: Record<string, Record<string, unknown>[]> = {}
let cacheScope = ''
let started = false
let client: ReturnType<typeof createClient> | undefined
let fetching: Promise<void> | undefined
let refreshAgain = false
let realtimeRefreshPending = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let realtimeEnabled = false
let realtimeChannel: ReturnType<ReturnType<typeof createClient>['channel']> | undefined
let realtimeScope = ''
let pollTimer: number | undefined
const listeners = new Set<() => void>()
function emit() { listeners.forEach(listener => listener()) }
function setConnection(update: Partial<Connection>) { connection = {...connection,...update}; emit() }
function db() { return client ??= createClient() }
async function readRequest<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Pemuatan data melewati batas waktu. Periksa koneksi lalu coba kembali.')), 30000)
  })
  try { return await Promise.race([request, timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
function queueRangeUpdate() {
  if (rangeUpdateQueued) return
  rangeUpdateQueued = true
  void Promise.resolve().then(() => {
    rangeUpdateQueued = false
    const today = jakartaDate(new Date())
    const ranges = requestedRanges.size ? [...requestedRanges.values()] : [{start:today,end:today}]
    const start = ranges.reduce((day, range) => range.start < day ? range.start : day, ranges[0].start)
    const end = ranges.reduce((day, range) => range.end > day ? range.end : day, ranges[0].end)
    // Reuse identical periods across menus. Shrink again after leaving a broad
    // report, so a monthly history does not stay in browser memory indefinitely.
    if (dataWindow.start === start && dataWindow.end === end) return
    dataWindow = {...dataWindow,start,end}
    branchRevision++
    if (started && connection.profile) {
      setConnection({dataLoading:connection.state !== 'loading'})
      void refreshOnlineData().catch(() => {})
    }
  })
}
export function useDataRange(start:string,end:string) {
  const token = useRef(Symbol('data-range'))
  useEffect(() => {
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || start > end) return
    const key = token.current
    requestedRanges.set(key,{start,end}); queueRangeUpdate()
    return () => { requestedRanges.delete(key); queueRangeUpdate() }
  },[start,end])
}
export function selectDataOrder(id:string|null) {
  if (dataWindow.orderId === id) return
  dataWindow = {...dataWindow,orderId:id}
  // Leaving details can reuse the current data; entering an old archive must
  // explicitly include its complete order/history even outside the report dates.
  if (!id) return
  branchRevision++
  if (started && connection.profile) {
    setConnection({dataLoading:connection.state !== 'loading'})
    void refreshOnlineData().catch(() => {})
  }
}
export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    if ('code' in error && error.code === '23505' && /spk_code|orders_spk/i.test(error.message)) return 'Kode SPK sudah digunakan. Gunakan kode SPK lain.'
    if (error.message.includes('permission denied for table profiles') || error.message.includes('JWT') || ('code' in error && error.code === '42501')) return 'Sesi login telah berakhir. Silakan login kembali.'
    return error.message
  }
  return 'Tidak dapat terhubung ke server. Periksa jaringan dan coba lagi.'
}
async function allRows(table: string, branchId?: string | null, ids?: string[]) {
  const rows: Record<string, unknown>[] = []
  let after: string | null = null
  for (;;) {
    let query = db().from(table).select('*')
    if (branchId && ['orders','customers','process_history'].includes(table)) query = query.eq('branch_id',branchId)
    if (ids) query = query.in('id', ids)
    if (after) query = query.gt('id',after)
    const {data,error} = await readRequest(query.order('id').limit(1000))
    if (error) throw error
    rows.push(...data)
    if(data.length<1000) return rows
    after = String(data[data.length-1].id)
  }
}
async function fetchSnapshot() {
  const revision = branchRevision
  if (connection.dataLoading || connection.state === 'loading') setConnection({loadingRows:0})
  const snapshotWindow = {...dataWindow}
  const {data:profile,error:profileError}=await readRequest(db().from('profiles').select('id,full_name,role,is_active').eq('id',connection.profile?.id??'').maybeSingle())
  if(profileError)throw profileError
  if(!profile?.is_active)throw new Error('Akses akun sudah dinonaktifkan. Hubungi admin.')
  const role = normalizeRole(profile.role)
  if (!role) throw new Error('Role akun tidak valid. Hubungi Owner.')
  if (multiBranch) {
    const {data:context,error} = await readRequest(db().rpc('printex_branch_context'))
    if(error) throw error
    const branches = context.branches as Branch[]
    if (revision !== branchRevision) { refreshAgain=true; return }
    if(!branches.length && !context.central) throw new Error('Akun belum memiliki cabang aktif. Hubungi Owner Pusat.')
    if(selectedBranch === undefined || (selectedBranch !== null && !branches.some(branch=>branch.id===selectedBranch)) || (!context.central && selectedBranch === null)) selectedBranch = context.central ? null : context.branchId || branches[0].id
    const sameBranches = connection.branches?.length === branches.length && branches.every((branch, index) => branch.id === connection.branches?.[index].id && branch.name === connection.branches[index].name)
    if (!sameBranches || connection.branchId !== selectedBranch || connection.central !== context.central) {
      setConnection({branches: sameBranches ? connection.branches : branches,branchId:selectedBranch,central:context.central})
    }
  }
  if(connection.reportSummariesEnabled && metadataView && !snapshotWindow.orderId) {
    if(revision!==branchRevision){refreshAgain=true;return}
    orders=EMPTY_ORDERS;active=EMPTY_ORDERS;production=EMPTY_ORDERS;history=EMPTY_HISTORY;rowCache={};cacheScope='';syncCursor=null
    setConnection({state:'ready',profile:{id:profile.id,full_name:profile.full_name,role},dataLoading:false,loadingRows:0,error:'',lastSyncedAt:Date.now()})
    return
  }
  const snapshotBranch = selectedBranch
  // Role and branch changes invalidate all cached rows, including any newly inaccessible data.
  const allowedBranches = connection.branches?.map(branch=>branch.id).sort().join(',') ?? ''
  const scope = `${profile.id}:${role}:${snapshotBranch ?? 'all'}:${allowedBranches}:${snapshotWindow.start}:${snapshotWindow.end}:${snapshotWindow.orderId ?? ''}`
  const reuse = cacheScope === scope
  let cursor: string | null = null
  let changes: {table: string; id: string}[] | null = null
  {
    const { data, error } = await readRequest(db().rpc('printex_sync_changes', { p_after: reuse ? syncCursor : null, p_branch: snapshotBranch ?? null }))
    if (error?.code === 'PGRST202' || error?.code === '42883') { /* Retry on the next refresh, so an installed migration is picked up without reloading. */ }
    else if (error) throw error
    else { cursor = data.cursor; if (reuse && syncCursor !== null && !data.reset) changes = data.changes }
  }
  const tables = ['orders','customers','production_steps','process_history']
  // An order newly entering this window needs its entire earlier history, not
  // just the latest transition, to preserve original milestones and durations.
  if (changes?.some(change => change.table === 'orders' && !rowCache.orders?.some(row => row.id === change.id))) changes = null
  let scopedRows: Record<string, Record<string, unknown>[]> | null = null
  let scopedLoading = connection.scopedLoading ?? false
  if (changes === null || changes.length) {
    const {data,error} = await readRequest(db().rpc('printex_scoped_snapshot', {
      p_start:snapshotWindow.start,p_end:snapshotWindow.end,p_branch:snapshotBranch ?? null,
      p_order:snapshotWindow.orderId,p_changes:changes,
    }))
    if (error?.code === 'PGRST202' || error?.code === '42883') scopedLoading = false
    else if (error) throw error
    else {
      scopedRows = Object.fromEntries(tables.map(table => [table, data[table]])); scopedLoading = true
      let page = data
      while (page.history_more) {
        if (revision !== branchRevision) { refreshAgain=true; return }
        if (connection.dataLoading || connection.state === 'loading') setConnection({loadingRows:scopedRows!.process_history.length})
        const after = page.history_cursor
        if (!after) throw new Error('Urutan riwayat tidak valid. Silakan coba kembali.')
        const next = await readRequest(db().rpc('printex_scoped_snapshot', {
          p_start:snapshotWindow.start,p_end:snapshotWindow.end,p_branch:snapshotBranch ?? null,
          p_order:snapshotWindow.orderId,p_changes:changes,p_history_after:after,
          p_history_only:true,p_history_ids:data.identities,
        }))
        if (next.error) throw next.error
        page = next.data
        if (page.history_more && page.history_cursor === after) throw new Error('Urutan riwayat tidak berubah. Silakan coba kembali.')
        scopedRows!.process_history.push(...page.process_history)
      }
      // Sort the bounded result in memory instead of forcing PostgreSQL to
      // spill large JSON rows to disk just to establish UUID ordering.
      for (const rows of Object.values(scopedRows!)) rows.sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0)
    }
  }
  const snapshots = await Promise.all(tables.map(async table => {
    if (scopedRows) {
      if (changes === null) return scopedRows[table]
      const ids = new Set(changes.filter(change => change.table === table).map(change => change.id))
      if (!ids.size) return rowCache[table]
      return [...rowCache[table].filter(row => !ids.has(String(row.id))), ...scopedRows[table]]
    }
    if (changes === null) return allRows(table,snapshotBranch)
    const ids = [...new Set(changes.filter(change => change.table === table).map(change => change.id))]
    if (!ids.length) return rowCache[table]
    const updated: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i += 100) updated.push(...await allRows(table,snapshotBranch,ids.slice(i,i+100)))
    // Missing IDs were deleted or lost access; remove them from memory as well.
    const changed = new Set(ids)
    return [...rowCache[table].filter(row => !changed.has(String(row.id))), ...updated]
  }))
  if (revision !== branchRevision) { refreshAgain=true; return }
  if (reuse && snapshots.every((rows,index) => rows === rowCache[tables[index]])) {
    syncCursor = cursor
    setConnection({state:'ready',dataLoading:false,scopedLoading,dataRange:snapshotWindow,syncMode:cursor === null ? 'full' : 'incremental',lastSyncedAt:Date.now(),error:'',profile:{...profile,role}})
    return
  }
  const [orderRows,customers,steps,eventRows] = snapshots
  const stepMap = new Map(steps.map(step => [step.id,step]))
  const customerMap = new Map(customers.map(customer => [customer.id,customer]))
  if(PROCESS_STAGES.some(stage => !steps.some(step=>step.code===BOARD_STAGE_META[stage].code))) throw new Error('Tahapan produksi belum lengkap. Jalankan SETUP_ONLINE.sql.')
  const stageFromStep = (id: unknown): BoardStageId => {
    const found = PROCESS_STAGES.find(stage=>BOARD_STAGE_META[stage].code===stepMap.get(id)?.code)
    if(!found) throw new Error('Ada order/riwayat dengan tahap tidak valid. Periksa database.')
    return found
  }
  const previousOrderRows = new Map((reuse ? rowCache.orders : []).map(row => [row.id, row]))
  const previousCustomers = new Map((reuse ? rowCache.customers : []).map(row => [row.id, row]))
  const previousSteps = new Map((reuse ? rowCache.production_steps : []).map(row => [row.id, row]))
  const previousOrders = new Map(orders.map(order => [order.id, order]))
  const nextOrders: BoardOrder[] = reuse && orderRows === rowCache.orders && customers === rowCache.customers && steps === rowCache.production_steps ? orders : orderRows.map(row=>{
    const previous = previousOrders.get(String(row.id))
    if (previous && previousOrderRows.get(row.id) === row && previousCustomers.get(row.customer_id) === customerMap.get(row.customer_id) && previousSteps.get(row.current_step_id) === stepMap.get(row.current_step_id)) return previous
    const stage=stageFromStep(row.current_step_id), meta=BOARD_STAGE_META[stage], customer=customerMap.get(row.customer_id)
    return {id:String(row.id),branch_id:row.branch_id?String(row.branch_id):undefined,spk_code:String(row.spk_code),customer:{name:String(customer?.name??''),phone:String(customer?.phone??'')},
      production_type:String(row.production_type),meter:Number(row.meter),paper_width:row.paper_width == null ? null : String(Number(row.paper_width)),customer_type:String(row.customer_type),order_state:meta.orderState,
      current_step:{code:meta.code,name:meta.name},board_stage:stage,color_token:meta.color,order_date:String(row.order_date),due_at:String(row.due_at??''),
      notes:String(row.notes??''),created_at:String(row.created_at),version:Number(row.version),photo_path:row.photo_path?String(row.photo_path):null,
      archive:row.archived_at?{archivedAt:String(row.archived_at),deliveryMethod:row.delivery_method as DeliveryMethod,finalizedAt:row.archive_finalized_at?String(row.archive_finalized_at):undefined}:null}
  })
  const previousEventRows = new Map((reuse ? rowCache.process_history : []).map(row => [row.id, row]))
  const previousEvents = new Map(history.map(event => [event.id, event]))
  const nextHistory: ProcessEvent[] = reuse && eventRows === rowCache.process_history && steps === rowCache.production_steps ? history : eventRows.flatMap(row=>{
    const previous = previousEvents.get(String(row.id))
    if (previous && previousEventRows.get(row.id) === row && previousSteps.get(row.step_id) === stepMap.get(row.step_id) && !row.next_step_id) return [previous]
    const event: ProcessEvent = {branchId:row.branch_id?String(row.branch_id):undefined,id:String(row.id),orderId:String(row.order_identity??row.order_id),spkCode:String(row.spk_code),customerName:String(row.customer_name??''),
    stage:stageFromStep(row.step_id),kind:row.event_kind as ProcessEvent['kind'],occurredAt:String(row.occurred_at),actorName:row.actor_name?String(row.actor_name):null}
    return row.next_step_id && stepMap.get(row.next_step_id)?.code !== 'ARCHIVE' ? [event,{...event,id:String(row.next_event_id ?? `${row.id}:entered`),stage:stageFromStep(row.next_step_id),kind:'entered' as const}] : [event]
  })
  if (revision !== branchRevision) { refreshAgain=true; return }
  rowCache = Object.fromEntries(tables.map((table,index) => [table,snapshots[index]]))
  cacheScope = scope; syncCursor = cursor
  if (orders !== nextOrders) {
    orders=nextOrders;active=orders.filter(order=>order.board_stage!=='archive');production=orders.filter(order=>!order.archive?.finalizedAt)
  }
  history=nextHistory
  setConnection({state:'ready',dataLoading:false,scopedLoading,dataRange:snapshotWindow,syncMode:cursor === null ? 'full' : 'incremental',lastSyncedAt:Date.now(),error:'',profile:{...profile,role}})
}
export async function refreshOnlineData() {
  // An explicit refresh also covers notifications still waiting in the batch.
  if (refreshTimer !== undefined) { clearTimeout(refreshTimer); refreshTimer = undefined }
  if(fetching) { refreshAgain=true; return fetching }
  fetching=(async()=>{do {refreshAgain=false;await fetchSnapshot()}while(refreshAgain)})()
  try {await fetching} catch(error) {syncCursor=null;rowCache={};cacheScope='';setConnection({state:'error',dataLoading:false,error:errorMessage(error)});throw error} finally {
    fetching=undefined
    if (realtimeEnabled && connection.state === 'ready') ensureRealtime()
    if (realtimeEnabled) schedulePoll()
    if (realtimeRefreshPending) { realtimeRefreshPending = false; scheduleRefresh() }
  }
}
function scheduleRefresh() {
  // One transaction can update orders, customers and several history rows.
  // Collect these notifications instead of fetching a full snapshot per row.
  if (document.visibilityState !== 'visible' || refreshTimer !== undefined) return
  // Notifications arriving during a fetch must not keep its awaited loop alive.
  // Queue one trailing refresh so writes can finish even during a bulk import.
  if (fetching) { realtimeRefreshPending = true; return }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    if (document.visibilityState === 'visible') void refreshOnlineData().catch(() => {})
  }, 1000)
}
function schedulePoll() {
  if (pollTimer !== undefined) window.clearTimeout(pollTimer)
  pollTimer = undefined
  if (document.visibilityState !== 'visible') return
  pollTimer = window.setTimeout(() => {
    pollTimer = undefined
    if (document.visibilityState === 'visible') void refreshOnlineData().catch(() => {})
  }, connection.realtime && connection.state === 'ready' ? 300000 : 30000)
}
function ensureRealtime() {
  // Central owners retain all-branch notifications; branch staff receive their own branch only.
  const branch = multiBranch && !connection.central ? connection.branchId : null
  const scope = `${connection.profile?.id}:${branch ?? 'all'}`
  if (realtimeChannel && realtimeScope === scope) return
  const previous = realtimeChannel
  realtimeScope = scope
  const channel = db().channel(`printex-board-${crypto.randomUUID()}`)
  realtimeChannel = channel
  if (previous) void db().removeChannel(previous)
  setConnection({realtime:false})
  for (const table of ['orders','customers','process_history','production_steps','profiles']) {
    const filter = table === 'profiles' ? `id=eq.${connection.profile!.id}`
      : branch && table !== 'production_steps' ? `branch_id=eq.${branch}` : undefined
    const notify = () => { if (realtimeChannel === channel) scheduleRefresh() }
    if (!filter) channel.on('postgres_changes',{event:'*',schema:'public',table},notify)
    else {
      channel.on('postgres_changes',{event:'INSERT',schema:'public',table,filter},notify)
      channel.on('postgres_changes',{event:'UPDATE',schema:'public',table,filter},notify)
      // DELETE may carry only its primary key. Keep this subscription unfiltered,
      // but ignore IDs absent from the authorized snapshot before doing any work.
      channel.on('postgres_changes',{event:'DELETE',schema:'public',table},payload => {
        const id = payload.old.id
        if (table === 'profiles' ? id === connection.profile?.id : rowCache[table]?.some(row => row.id === id)) notify()
      })
    }
  }
  channel.subscribe(status => {
    if (realtimeChannel !== channel) return
    setConnection({realtime:status === 'SUBSCRIBED'})
    schedulePoll()
    if (status === 'SUBSCRIBED') scheduleRefresh()
  })
}
async function start() {
  try {
    const {data:{user},error}=await readRequest(db().auth.getUser())
    if(error||!user) throw new Error('Silakan login untuk membuka data online.')
    const {data:profile,error:profileError}=await readRequest(db().from('profiles').select('id,full_name,role,is_active').eq('id',user.id).maybeSingle())
    if(profileError) throw profileError
    if(!profile?.is_active) throw new Error('Akun belum diaktifkan sebagai karyawan. Hubungi admin.')
    const role = normalizeRole(profile.role)
    if (!role) throw new Error('Role akun tidak valid. Hubungi Owner.')
    setConnection({profile:{...profile,role}})
    const {data:ready,error:setupError}=await readRequest(db().rpc('printex_online_status'))
    if(setupError||ready?.schema_version!==ACCESS_SCHEMA_VERSION) throw new Error('Hak akses database belum diperbarui. Jalankan migrasi 0013_owner_operator_permissions.sql di Supabase SQL Editor.')
    multiBranch = ready.branches_enabled === true
    setConnection({reportSummariesEnabled:ready.daily_summaries_enabled===true})
    const requiredTables=['orders','customers','production_steps','process_history','profiles']
    if(requiredTables.some(table=>!ready.realtime_tables?.includes(table))) throw new Error('Realtime belum diaktifkan untuk seluruh tabel.')
    realtimeEnabled = true
    const resume = () => { if (document.visibilityState === 'visible') scheduleRefresh() }
    window.addEventListener('online',resume)
    window.addEventListener('offline',()=>{setConnection({state:'error',realtime:false,error:'Koneksi terputus. Perubahan dinonaktifkan sampai terhubung kembali.'});schedulePoll()})
    window.addEventListener('focus',resume)
    document.addEventListener('visibilitychange',()=>{
      if (refreshTimer !== undefined) {clearTimeout(refreshTimer);refreshTimer=undefined}
      schedulePoll()
      resume()
    })
    await refreshOnlineData()
  } catch(error) {setConnection({state:'error',error:errorMessage(error)})}
}
function subscribe(listener:()=>void) {listeners.add(listener);if(!started){started=true;void start()}return()=>{listeners.delete(listener)}}
export function useAllOrders(){return useSyncExternalStore(subscribe,()=>orders,()=>EMPTY_ORDERS)}
export function useBoardOrders(){return useSyncExternalStore(subscribe,()=>active,()=>EMPTY_ORDERS)}
export function useProductionOrders(){return useSyncExternalStore(subscribe,()=>production,()=>EMPTY_ORDERS)}
export function useProcessHistory(){return useSyncExternalStore(subscribe,()=>history,()=>EMPTY_HISTORY)}
export function useOnlineConnection(){return useSyncExternalStore(subscribe,()=>connection,()=>INITIAL_CONNECTION)}

async function mutate(action:string,id:string,data:unknown={}) {
  if(connection.state!=='ready'||connection.busy||connection.dataLoading) throw new Error('Tunggu sinkronisasi selesai sebelum mengubah order.')
  const order=orders.find(item=>item.id===id)
  if (action !== 'create' && !order) throw new Error('Order tidak tersedia pada cabang aktif.')
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
    if ((action === 'delete' || action === 'finish' || action === 'archive' && data && typeof data === 'object' && 'deliveryMethod' in data && data.deliveryMethod === 'received') && order?.photo_path) await cleanupOrderPhotos(order.photo_path).catch(() => {})
    await refreshOnlineData()
  } catch(error) {setConnection({error:errorMessage(error)});throw error} finally {setConnection({busy:false})}
}
export async function addOrder(input:NewOrderInput,id=crypto.randomUUID()){
  if(multiBranch && !selectedBranch) throw new Error('Pilih satu cabang sebelum menambah order.')
  await mutate('create',id,multiBranch?{...input,branchId:selectedBranch}:input);return orders.find(order=>order.id===id)}
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
export async function archiveOrder(id:string,deliveryMethod:DeliveryMethod='received'){
  const order=orders.find(item=>item.id===id)
  if(order?.board_stage==='archive'&&!order.archive?.finalizedAt) await mutate('finish',id)
  else await mutate('archive',id,{deliveryMethod})
  return true
}
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
      const { error } = await storage.upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })
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


export async function selectBranch(id: string | null, options: { history?: boolean; room?: 'all' | null } = {}) {
  if (!multiBranch || connection.busy || connection.state !== 'ready') return
  if (id === null ? !connection.central : !connection.branches?.some(branch => branch.id === id)) return
  if (options.history !== false) recordRoomNavigation(id, options.room ?? null)
  if (selectedBranch === id) return
  selectedBranch = id
  branchRevision++
  orders = active = production = EMPTY_ORDERS
  history = EMPTY_HISTORY
  setConnection({state:'loading',branchId:id})
  await refreshOnlineData()
}
