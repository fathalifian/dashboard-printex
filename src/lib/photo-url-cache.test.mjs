import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('./photo-url-cache.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports})
const {createPhotoUrlCache}=exports
test('photo URLs share in-flight signing and remain stable until expiry or invalidation',async()=>{
 let time=0,calls=0,release
 const cache=createPhotoUrlCache(()=>{calls++;return new Promise(resolve=>{release=resolve})},()=>time)
 const first=cache.get('a'),second=cache.get('a');assert.equal(first,second);assert.equal(calls,1)
 release('signed-a');const result=await first
 time=8*60*1000;assert.equal(await cache.get('a'),result);assert.equal(calls,1)
 time=9*60*1000;const renewed=cache.get('a');assert.equal(calls,2);release('new-a');await renewed
 cache.invalidate('a');const retry=cache.get('a');assert.equal(calls,3);release('retry-a');await retry
 cache.clear();const account=cache.get('a');assert.equal(calls,4);release('other-account');await account
})
test('failed signing can retry and a cleared pending request cannot repopulate cache',async()=>{
 let calls=0
 const cache=createPhotoUrlCache(async()=>{if(++calls===1)throw Error('offline');return 'ok'})
 await assert.rejects(cache.get('a'),/offline/);assert.equal((await cache.get('a')).url,'ok')
 let release
 const pending=createPhotoUrlCache(()=>new Promise(resolve=>{release=resolve}))
 const old=pending.get('a');pending.clear();release('old');await old
 const next=pending.get('a');assert.notEqual(next,old);release('new');assert.equal((await next).url,'new')
})
