'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { requestReport } from './report-client'
import { BOARD_STAGE_META, useOnlineConnection, type BoardOrder } from './production-board'
import { PAPER_WIDTHS, type PaperWidth } from './paper-output'
import type { ProcessEvent, ProcessStage } from './process-metrics'

type SummaryRow = { day:string;branchId:string;metric:string;dimension:string;count:number;meter:number;milliseconds:number }
type ReportItem = { day:string;milliseconds:number;productionMilliseconds?:number|null;order?:BoardOrder;event?:Omit<ProcessEvent,'stage'> }
type Result = {rows:SummaryRow[];items:ReportItem[];total:number;loading:boolean;error:string;asOf?:string}
const empty:Result = {rows:[],items:[],total:0,loading:true,error:''}
const disabled = {...empty,loading:false}
const entries = new Map<string,{value:Result;listeners:Set<()=>void>;request?:Promise<void>;at:number;revision:number}>()
type ReportResponse = { rows?: SummaryRow[]; items?: ReportItem[]; total?: number; pending?: boolean; asOf?: string }
function entry(key:string) {
  let item=entries.get(key)
  if(!item) {item={value:empty,listeners:new Set(),at:0,revision:0};entries.set(key,item)}
  return item
}
async function request(key:string,rpc:string,args:Record<string,unknown>,force=false,revision=0) {
  const item=entry(key)
  if(revision&&item.revision>=revision)return
  if(revision)item.revision=revision
  if(item.request)return item.request
  if(!force && Date.now()-item.at<30000)return
  const emit=()=>item.listeners.forEach(fn=>fn())
  item.request=(async()=>{
    try {
      const data=await requestReport<ReportResponse>(rpc,args,force)
      if(data.pending)throw new Error('Ringkasan sedang diperbarui. Coba kembali beberapa saat lagi.')
      item.value={rows:data.rows??[],items:data.items??[],total:data.total??0,loading:false,error:'',asOf:data.asOf}
      item.at=Date.now()
    }catch(error){item.value={...item.value,loading:false,error:error instanceof Error?error.message:'Laporan belum dapat dimuat.'}}
    finally{item.request=undefined;emit()}
  })()
  emit()
  return item.request
}
function useStoredReport(rpc:string,args:Record<string,unknown>,active=true) {
  const status=useOnlineConnection()
  const enabled=status.reportSummariesEnabled===true
  const identity=[status.profile?.id,status.profile?.role,status.branches?.map(branch=>branch.id).sort().join(',')]
  const serialized=JSON.stringify({...args,p_branch:status.branchId??null})
  const key=JSON.stringify([identity,rpc,serialized])
  const ready=enabled && active && status.state==='ready'
  const value=useSyncExternalStore(listener=>{
    if(!ready)return()=>{}
    const item=entry(key);item.listeners.add(listener)
    return()=>{item.listeners.delete(listener);if(entries.size>12)for(const [k,v]of entries)if(!v.listeners.size&&!v.request&&k!==key)entries.delete(k)}
  },()=>ready?entry(key).value:disabled,()=>disabled)
  useEffect(()=>{
    if(!ready)return
    void request(key,rpc,JSON.parse(serialized))
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void request(key,rpc,JSON.parse(serialized))},30000)
    return()=>window.clearInterval(timer)
  },[ready,key,rpc,serialized])
  useEffect(()=>{if(ready && status.lastSyncedAt)void request(key,rpc,JSON.parse(serialized),true,status.lastSyncedAt)},[ready,key,rpc,serialized,status.lastSyncedAt])
  return {...value,enabled,retry:()=>request(key,rpc,JSON.parse(serialized),true)}
}
export function useDailySummary(start:string,end:string) {
  return useStoredReport('printex_daily_report',{p_start:start,p_end:end},!!start&&!!end&&start<=end)
}
export function useReportDetails(start:string,end:string,metric:string,dimension='',page=1,search='',active=true) {
  return useStoredReport('printex_report_details',{p_start:start,p_end:end,p_metric:metric,p_dimension:dimension,p_offset:(page-1)*50,p_limit:50,p_search:search.trim()},active&&!!start&&!!end&&start<=end)
}
export async function exportReportDetails(start:string,end:string,dimension:string,branch:string|null) {
  const items:ReportItem[]=[]
  for(let offset=0;;offset+=200){
    const data=await requestReport<{items:ReportItem[];total:number}>('printex_report_details',{p_start:start,p_end:end,p_metric:'process',p_dimension:dimension,p_branch:branch,p_offset:offset,p_limit:200},true)
    items.push(...data.items)
    if(items.length>=data.total || !data.items.length)return items
  }
}
export function total(rows:SummaryRow[],metric:string,dimension?:string,branch?:string|null,day?:string) {
  return rows.reduce((sum,row)=>row.metric===metric&&(dimension===undefined||row.dimension===dimension)&&(!branch||row.branchId===branch)&&(!day||row.day===day)?{count:sum.count+Number(row.count),meter:sum.meter+Number(row.meter),milliseconds:sum.milliseconds+Number(row.milliseconds)}:sum,{count:0,meter:0,milliseconds:0})
}
export function storedOutput(rows:SummaryRow[],branch?:string|null,day?:string) {
  return {dtf:total(rows,'output','dtf',branch,day),sublim:total(rows,'output','sublim',branch,day)}
}
function reportDays(start:string,end:string) {
  const days:string[]=[]
  for(let date=Date.parse(start+'T12:00:00Z');Number.isFinite(date)&&date<=Date.parse(end+'T12:00:00Z')&&days.length<366;date+=86400000)days.push(new Date(date).toISOString().slice(0,10))
  return days
}
export function storedTrend(rows:SummaryRow[],start:string,end:string,branch?:string|null) {
  return reportDays(start,end).map(day=>({day,...storedOutput(rows,branch,day)}))
}
export function storedPaper(rows:SummaryRow[],start:string,end:string,branch?:string|null) {
  const values=(day?:string)=>Object.fromEntries([...PAPER_WIDTHS,'unknown'].map(width=>[width,total(rows,'paper',width,branch,day)])) as unknown as Record<PaperWidth|'unknown',{count:number;meter:number}>
  return {totals:values(),trend:reportDays(start,end).map(day=>({day,values:values(day)}))}
}
export function storedEvent(item:ReportItem,stage:ProcessStage):ProcessEvent {
  return {...item.event!,stage}
}
export function stageCode(stage:ProcessStage){return BOARD_STAGE_META[stage].code}
