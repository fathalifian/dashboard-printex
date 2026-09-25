import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const codes=['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','PRESS','DONE','ARCHIVE']
function backend() {
  const state={orders:[],customers:[],production_steps:codes.map((code,index)=>({id:String(index),code})),process_history:[],profiles:[{id:'user',full_name:'Admin',role:'owner',is_active:true}]}
  const subscriptions=[]
  const photos = new Map()
  const emit=()=>subscriptions.forEach(fn=>fn())
  const client={
    storage: { from(bucket) {
      assert.equal(bucket, 'order-photos')
      return {
        async upload(path, file) { photos.set(path, file); return { error: null } },
        async remove(paths) { paths.forEach(path => photos.delete(path)); return { error: null } },
      }
    } },
    auth:{getUser:async()=>({data:{user:{id:'user'}}})},
    from(table) {
      return {select() {
        return {
          eq() {return {maybeSingle:async()=>({data:state.profiles[0]})}},
          order() {return {range:async(start,end)=>({data:structuredClone(state[table].slice(start,end+1))})}},
        }
      }}
    },
    async rpc(name,args){
      if(name==='printex_online_status')return {data:{schema_version:8,realtime_tables:Object.keys(state)}}
      if (name === 'printex_claim_photo_cleanup') return { data: [...photos.keys()].filter(path => (!args.p_path || args.p_path === path) && !state.orders.some(order => order.photo_path === path)).map(path => ({ path })) }
      const row=state.orders.find(row=>row.id===args.p_order_id)
      if (name === 'printex_set_order_photo') {
        if (row.version !== args.p_expected_version) return { error: { message: 'Order sudah diubah perangkat lain', code: '40001' } }
        row.photo_path = args.p_path; row.version++; emit(); return { error: null }
      }
      if(args.p_action==='create'){
        state.customers.push({id:'customer',name:args.p_data.customerName})
        state.orders.push({id:args.p_order_id,spk_code:'SPK-1100',customer_id:'customer',current_step_id:'0',production_type:'DTF',meter:1,customer_type:'regular',order_date:'2026-09-07',due_at:'2026-09-08',created_at:'2026-09-07T00:00:00Z',version:1})
      }else{
        if(row.version!==args.p_expected_version)return {error:{message:'Order sudah diubah perangkat lain',code:'40001'}}
        if (args.p_action === 'delete') state.orders.splice(state.orders.indexOf(row), 1)
        else { row.current_step_id=String(codes.indexOf(args.p_data.code));row.version++ }
      }
      emit();return {data:args.p_order_id}
    },
    channel(){return {on(_event,_filter,callback){subscriptions.push(callback);return this},subscribe(callback){callback('SUBSCRIBED');return this}}},
  }
  return {state,client,emit,photos}
}
function device(client) {
  const cache={};let storageWrites=0;const events={}
  function load(name) {
    if(name==='react')return {useSyncExternalStore(subscribe,getSnapshot){subscribe(()=>{});return getSnapshot()}}
    if(name==='@/lib/supabase/client')return {createClient:()=>client}
    if(name==='@/lib/order-photo')return {ORDER_PHOTO_BUCKET:'order-photos',compressOrderPhoto:async file=>{
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Pilih foto JPG, PNG, atau WebP.')
      return { ...file, type: 'image/webp' }
    }}
    if(cache[name])return cache[name]
    const file=new URL(name.replace('@/lib/','')+'.ts',import.meta.url)
    const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
    const exports={};cache[name]=exports
    runInNewContext(source,{exports,require:load,crypto,Intl,Date,setTimeout,clearTimeout,document:{visibilityState:'visible'},window:{addEventListener(name,callback){events[name]=callback},setInterval(){},localStorage:{getItem(){storageWrites++;throw new Error('Local storage is forbidden')},setItem(){storageWrites++;throw new Error('Local storage is forbidden')}}}})
    return exports
  }
  return {board:load('@/lib/production-board'),writes:()=>storageWrites,events}
}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('State did not synchronize')}

test('photo upload, replacement and removal synchronize while failure preserves the existing photo', async () => {
  const api = backend(), a = device(api.client), b = device(api.client)
  a.board.useOnlineConnection(); b.board.useOnlineConnection()
  await waitFor(() => a.board.useOnlineConnection().state === 'ready' && b.board.useOnlineConnection().state === 'ready')
  await a.board.addOrder({ customerName: 'Photo', productionType: 'DTF', meter: 1, customerType: 'regular', orderDate: '2026-09-25', dueDate: '2026-09-26', notes: '' }, 'photo-order')
  assert.equal(a.board.useAllOrders()[0].photo_path, null)
  await a.board.saveOrderPhoto('photo-order', { type: 'image/jpeg', size: 100 })
  const first = a.board.useAllOrders()[0].photo_path
  assert.match(first, /^photo-order\/.*\.webp$/)
  await waitFor(() => b.board.useAllOrders()[0]?.photo_path === first)
  await assert.rejects(() => a.board.saveOrderPhoto('photo-order', { type: 'image/svg+xml', size: 100 }), /JPG/)
  assert.equal(a.board.useAllOrders()[0].photo_path, first)
  const from = api.client.storage.from
  api.client.storage.from = () => ({ upload: async () => ({ error: { message: 'Upload gagal' } }) })
  await assert.rejects(() => a.board.saveOrderPhoto('photo-order', { type: 'image/png', size: 100 }), { message: 'Upload gagal' })
  assert.equal(a.board.useOnlineConnection().busy, false)
  assert.equal(a.board.useAllOrders()[0].photo_path, first)
  api.client.storage.from = from
  await a.board.saveOrderPhoto('photo-order', { type: 'image/png', size: 100 })
  assert.equal(api.photos.has(first), false)
  assert.match(a.board.useAllOrders()[0].photo_path, /\.webp$/)
  await a.board.saveOrderPhoto('photo-order', null)
  await waitFor(() => b.board.useAllOrders()[0]?.photo_path === null)
  assert.equal(api.photos.size, 0)
  api.state.profiles[0].role = 'operator'; api.emit()
  await waitFor(() => a.board.useOnlineConnection().profile.role === 'operator')
  await assert.rejects(() => a.board.saveOrderPhoto('photo-order', { type: 'image/png', size: 100 }), /Owner\/Admin/)
})

test('failed photo links clean orphan uploads, lost responses preserve committed photos, and deletion removes files', async () => {
  const api = backend(), a = device(api.client)
  a.board.useOnlineConnection()
  await waitFor(() => a.board.useOnlineConnection().state === 'ready')
  await a.board.addOrder({ customerName: 'Cleanup', productionType: 'DTF', meter: 1, customerType: 'regular', orderDate: '2026-09-25', dueDate: '2026-09-26', notes: '' }, 'cleanup-order')
  const rpc = api.client.rpc
  api.client.rpc = async (name, args) => name === 'printex_set_order_photo' ? { error: { message: 'Version conflict', code: '40001' } } : rpc(name, args)
  await assert.rejects(() => a.board.saveOrderPhoto('cleanup-order', { type: 'image/png', size: 100 }), { message: 'Version conflict' })
  assert.equal(api.photos.size, 0)
  api.client.rpc = async (name, args) => {
    const result = await rpc(name, args)
    if (name === 'printex_set_order_photo') throw new Error('Lost response')
    return result
  }
  await assert.rejects(() => a.board.saveOrderPhoto('cleanup-order', { type: 'image/png', size: 100 }), /Lost response/)
  assert.equal(api.photos.size, 1)
  assert.ok(api.photos.has(api.state.orders[0].photo_path))
  api.client.rpc = rpc
  await a.board.refreshOnlineData()
  const from = api.client.storage.from
  api.client.storage.from = () => ({ remove: async () => ({ error: { message: 'Offline' } }) })
  await a.board.deleteOrder('cleanup-order')
  assert.equal(api.state.orders.length, 0)
  assert.equal(api.photos.size, 1)
  api.client.storage.from = from
  await a.board.cleanupOrderPhotos()
  assert.equal(api.photos.size, 0)
})

test('two devices refresh from realtime, never write offline data, reject stage skips',async()=>{
  const api=backend(),a=device(api.client),b=device(api.client)
  a.board.useOnlineConnection();b.board.useOnlineConnection()
  await waitFor(()=>a.board.useOnlineConnection().state==='ready'&&b.board.useOnlineConnection().state==='ready')
  await a.board.addOrder({customerName:'Online',productionType:'DTF',meter:1,customerType:'regular',orderDate:'2026-09-07',dueDate:'2026-09-08',notes:''},'order-1')
  await waitFor(()=>b.board.useAllOrders().length===1)
  assert.equal(a.writes(),0);assert.equal(b.writes(),0)
  assert.equal(await a.board.moveOrderToStage('order-1','done'),false)
  assert.equal(await a.board.moveOrderToStage('order-1','design'),true)
  await waitFor(()=>b.board.useAllOrders()[0].board_stage==='design')
  api.state.orders[0].current_step_id='6';api.state.orders[0].archived_at='2026-09-07T01:00:00Z';api.state.orders[0].delivery_method='pickup';api.emit()
  await waitFor(()=>b.board.useProductionOrders()[0]?.board_stage==='archive')
  api.state.orders[0].archive_finalized_at='2026-09-08T01:00:00Z';api.emit()
  await waitFor(()=>b.board.useProductionOrders().length===0)
  assert.equal(b.board.useAllOrders().length,1)
  a.events.offline()
  assert.equal(a.board.useOnlineConnection().state,'error')
  await assert.rejects(()=>a.board.addOrder({customerName:'Blocked'},'offline-order'),/sinkronisasi/)
  assert.equal(api.state.orders.length,1)
  a.events.online()
  await waitFor(()=>a.board.useOnlineConnection().state==='ready')
  assert.equal(a.writes(),0)
})

test('a live demotion removes create/edit/archive permissions and restricts both move endpoints',async()=>{
  const api=backend(),a=device(api.client)
  a.board.useOnlineConnection()
  await waitFor(()=>a.board.useOnlineConnection().state==='ready')
  const input={customerName:'Operator Test',productionType:'DTF',meter:1,customerType:'regular',orderDate:'2026-09-07',dueDate:'2026-09-08',notes:''}
  await a.board.addOrder(input,'restricted')
  api.state.profiles[0].role='operator';api.emit()
  await waitFor(()=>a.board.useOnlineConnection().profile.role==='operator')
  for(const attempt of [
    ()=>a.board.addOrder(input,'forged'),()=>a.board.updateOrder('restricted',{...input,spkCode:'forged'}),
    ()=>a.board.deleteOrder('restricted'),()=>a.board.archiveOrder('restricted','pickup'),()=>a.board.finishArchivedOrder('restricted'),
  ]) await assert.rejects(attempt,/Operator/)
  assert.equal(await a.board.moveOrderToStage('restricted','design_done'),false)
  api.state.orders[0].current_step_id='2';api.emit()
  await waitFor(()=>a.board.useProductionOrders()[0].board_stage==='design_done')
  assert.equal(await a.board.moveOrderToStage('restricted','design'),false)
  assert.equal(await a.board.moveOrderToStage('restricted','printing'),true)
  assert.equal(await a.board.moveOrderToStage('restricted','done'),true) // DTF skip remains available.
  assert.equal(await a.board.moveOrderToStage('restricted','archive'),false)
  assert.equal(await a.board.moveOrderToStage('restricted','press'),true)
  assert.equal(api.state.orders.length,1)
  assert.equal(a.writes(),0)
})

test('old database permissions never enable the new UI',async()=>{
  const api=backend()
  const rpc=api.client.rpc
  api.client.rpc=(name,args)=>name==='printex_online_status'?Promise.resolve({data:{schema_version:7,realtime_tables:Object.keys(api.state)}}):rpc(name,args)
  const a=device(api.client)
  a.board.useOnlineConnection()
  await waitFor(()=>a.board.useOnlineConnection().state==='error')
  assert.match(a.board.useOnlineConnection().error,/0013/)
  await assert.rejects(()=>a.board.addOrder({},'forged'),/sinkronisasi/)
  assert.equal(api.state.orders.length,0)
})


test('a burst of realtime notifications shares one snapshot refresh', async () => {
  const api = backend(); let snapshots = 0;
  const from = api.client.from;
  api.client.from = table => { if (table === 'orders') snapshots++; return from(table); };
  const a = device(api.client);
  a.board.useOnlineConnection();
  await waitFor(() => a.board.useOnlineConnection().realtime);
  await a.board.refreshOnlineData();
  snapshots = 0;
  for (let i = 0; i < 20; i++) api.emit();
  await waitFor(() => snapshots > 0);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(snapshots, 1);
});
