import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

test('photo signing starts on visibility, pauses offscreen/hidden and reuses cached URLs on focus',async()=>{
 const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 const cacheExports={};runInNewContext(compile('src/lib/photo-url-cache.ts'),{exports:cacheExports})
 let calls=0,cursor=0,nextTimer=0,observer
 const cache=cacheExports.createPhotoUrlCache(async path=>{calls++;return 'https://example.test/'+path})
 const slots=[],effects=[],timers=new Map(),events={}
 const document={visibilityState:'visible',addEventListener(name,fn){events[name]=fn},removeEventListener(name){delete events[name]}}
 const window={setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer},clearTimeout(id){timers.delete(id)},addEventListener(name,fn){events[name]=fn},removeEventListener(name){delete events[name]}}
 const react={
  useId:()=> 'photo-input',
  useRef(value){const i=cursor++;return slots[i]??={current:value}},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()}})},
 }
 const jsx=(type,props)=>({type,props})
 const dependencies={react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/image':{default:'Image'},'lucide-react':{},
  '@/lib/production-board':{},'@/lib/order-photo':{},
  '@/lib/order-photo-url':{getOrderPhotoUrl:path=>cache.get(path),invalidateOrderPhotoUrl:path=>cache.invalidate(path)}}
 const exports={}
 runInNewContext(compile('src/components/order-photo.tsx'),{exports,require:name=>dependencies[name],document,window,Date,
  IntersectionObserver:class{constructor(callback){observer=callback}observe(){}disconnect(){}}})
 const render=()=>{cursor=0;const tree=exports.default({orderId:'order',spkCode:'SPK',path:'a.png',editable:false});tree.props.ref.current={};effects.splice(0).forEach(fn=>fn());return tree}
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
 render();assert.equal(calls,0)
 observer([{isIntersecting:true}]);render();await tick();render();assert.equal(calls,1);assert.equal(timers.size,1)
 events.focus();events.focus();await tick();assert.equal(calls,1);assert.equal(timers.size,1)
 document.visibilityState='hidden';events.visibilitychange();assert.equal(timers.size,0)
 events.focus();await tick();assert.equal(calls,1)
 document.visibilityState='visible';events.visibilitychange();await tick();assert.equal(calls,1)
 observer([{isIntersecting:false}]);render();assert.equal(timers.size,0)
 for(const slot of slots)slot?.cleanup?.()
})
