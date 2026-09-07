import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const codes=['ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','DONE','ARCHIVE']
function backend() {
  const state={orders:[],customers:[],production_steps:codes.map((code,index)=>({id:String(index),code})),process_history:[],profiles:[{id:'user',full_name:'Admin',role:'superadmin',is_active:true}]}
  const subscriptions=[]
  const emit=()=>subscriptions.forEach(fn=>fn())
  const client={
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
      if(name==='printex_online_status')return {data:{schema_version:7,realtime_tables:Object.keys(state)}}
      const row=state.orders.find(row=>row.id===args.p_order_id)
      if(args.p_action==='create'){
        state.customers.push({id:'customer',name:args.p_data.customerName})
        state.orders.push({id:args.p_order_id,spk_code:'SPK-1100',customer_id:'customer',current_step_id:'0',production_type:'DTF',meter:1,customer_type:'regular',order_date:'2026-09-07',due_at:'2026-09-08',created_at:'2026-09-07T00:00:00Z',version:1})
      }else{
        if(row.version!==args.p_expected_version)return {error:{message:'Order sudah diubah perangkat lain',code:'40001'}}
        row.current_step_id=String(codes.indexOf(args.p_data.code));row.version++
      }
      emit();return {data:args.p_order_id}
    },
    channel(){return {on(_event,_filter,callback){subscriptions.push(callback);return this},subscribe(callback){callback('SUBSCRIBED');return this}}},
  }
  return {state,client,emit}
}
function device(client,storage=new Map()) {
  const cache={};let storageWrites=0
  function load(name) {
    if(name==='react')return {useSyncExternalStore(subscribe,getSnapshot){subscribe(()=>{});return getSnapshot()}}
    if(name==='@/lib/supabase/client')return {createClient:()=>client}
    if(cache[name])return cache[name]
    const file=new URL(name.replace('@/lib/','')+'.ts',import.meta.url)
    const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
    const exports={};cache[name]=exports
    runInNewContext(source,{exports,require:load,crypto,Intl,Date,document:{visibilityState:'visible'},window:{addEventListener(){},setInterval(){},localStorage:{getItem:key=>storage.get(key)??null,setItem(){storageWrites++}}}})
    return exports
  }
  return {board:load('@/lib/production-board'),legacy:load('@/lib/legacy-import'),writes:()=>storageWrites}
}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('State did not synchronize')}

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
  api.state.orders[0].current_step_id='5';api.state.orders[0].archived_at='2026-09-07T01:00:00Z';api.state.orders[0].delivery_method='pickup';api.emit()
  await waitFor(()=>b.board.useProductionOrders()[0]?.board_stage==='archive')
  api.state.orders[0].archive_finalized_at='2026-09-08T01:00:00Z';api.emit()
  await waitFor(()=>b.board.useProductionOrders().length===0)
  assert.equal(b.board.useAllOrders().length,1)
})

test('migration reads existing browser edits and deletes without resetting or fabricating dates',()=>{
  const store=new Map([
    ['printex-production-board-v2',JSON.stringify({'local-test':'design'})],
    ['printex-created-orders-v1',JSON.stringify([{id:'local-test',spk_code:'SPK-X',customer:{name:'Before',phone:''},current_step:{code:'ORDER_IN'},order_date:'2026-09-01',created_at:'2026-09-01T00:00:00Z'}])],
    ['printex-deleted-orders-v1',JSON.stringify(['1','2','3','4','5','6','7','8','9','10'])],
    ['printex-order-edits-v1',JSON.stringify({'local-test':{customerName:'After',spkCode:'SPK-EDIT',orderDate:'2026-09-02'}})],
  ])
  const d=device(backend().client)
  const payload=d.legacy.readLegacyData({getItem:key=>store.get(key)??null})
  assert.equal(payload.orders.length,1)
  assert.equal(payload.orders[0].customer.name,'After')
  assert.equal(payload.orders[0].board_stage,'design')
  assert.equal(payload.orders[0].order_date,'2026-09-02')
  assert.equal(payload.orders[0].created_at,'2026-09-01T00:00:00Z')
  assert.equal(payload.history.length,0)
  assert.equal(d.legacy.readLegacyData({getItem:()=>null}).orders.length,0)
})
