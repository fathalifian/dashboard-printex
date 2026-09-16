import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { NextRequest, NextResponse } = require('next/server')
function compile(file, dependencies) {
  const output = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const exports = {}
  new Function('require','exports',output)(name=>dependencies[name],exports)
  return exports
}
const access = compile('src/lib/access-control.ts',{})
function middleware(role, active=true, user=true) {
  return compile('src/lib/supabase/middleware.ts',{
    'next/server':{NextResponse}, '@/lib/access-control':access,
    './config':{supabaseConfig:()=>({url:'https://fixture.example',key:'fixture'})},
    '@supabase/ssr':{createServerClient:(_url,_key,options)=>({
      auth:{getUser:async()=>{
        options.cookies.setAll([{name:'refreshed-session',value:'fixture',options:{httpOnly:true}}])
        return {data:{user:user?{id:'user'}:null}}
      }},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,is_active:active}})})})}),
    })},
  }).updateSession
}
test('operator direct requests and prefetched RSC payloads cannot open restricted pages',async()=>{
  for(const path of ['/orders/new','/orders/123','/orders/123/edit','/reports','/archives','/settings','/settings/users']) {
    const request=new NextRequest('https://printex.example'+path+'?_rsc=fixture',{headers:{rsc:'1','next-router-prefetch':'1'}})
    const response=await middleware('operator')(request)
    assert.equal(response.status,307)
    assert.equal(response.headers.get('location'),'https://printex.example/dashboard')
    assert.equal(response.cookies.get('refreshed-session')?.value,'fixture')
  }
  for(const path of ['/dashboard','/schedule']) assert.equal((await middleware('operator')(new NextRequest('https://printex.example'+path))).status,200)
})
test('owner/admin access, inactive accounts, unknown roles and unauthenticated redirects',async()=>{
  const request=path=>new NextRequest('https://printex.example'+path)
  for(const role of ['owner','admin']) assert.equal((await middleware(role)(request('/orders/new'))).status,200)
  assert.equal((await middleware('owner')(request('/settings/users'))).status,200)
  assert.equal((await middleware('admin')(request('/settings/users'))).headers.get('location'),'https://printex.example/dashboard')
  for(const handler of [middleware('operator',false),middleware('unknown')]) {
    assert.equal((await handler(request('/dashboard'))).headers.get('location'),'https://printex.example/login?error=access')
  }
  assert.equal((await middleware('operator',true,false)(request('/schedule'))).headers.get('location'),'https://printex.example/login')
  assert.equal((await middleware('operator',true,false)(request('/login'))).status,200)
})
