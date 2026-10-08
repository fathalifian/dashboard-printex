'use client'

import Link from 'next/link'
import ReportStatus from '@/components/report-status'
import { useDailySummary, storedOutput, storedTrend, storedPaper, total } from '@/lib/report-summaries'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Building2, TriangleAlert } from 'lucide-react'
import CentralCharts from '@/components/dashboard/central-charts'
import PaperOutput from '@/components/dashboard/paper-output'
import ProductivityReport from '@/components/productivity-report'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import { BOARD_STAGE_META, selectBranch, useAllOrders, useOnlineConnection, useProcessHistory, type BoardOrder } from '@/lib/production-board'
import { paperOutput } from '@/lib/paper-output'
import { centralDashboardLiveSummary, centralDashboardSummary, longestPendingOrders, shiftDate } from '@/lib/central-dashboard'
import { jakartaDate, type ProcessEvent } from '@/lib/process-metrics'

const number = new Intl.NumberFormat('id-ID', {maximumFractionDigits:2})
const dateFormatter = new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'})
const shortDate = (value: string) => dateFormatter.format(new Date(value+'T12:00:00Z'))
const panel = 'rounded-2xl border border-slate-200 bg-white shadow-sm'
function duration(ms: number) {
  const hours = Math.floor(ms/3600000)
  if (hours>=24) return Math.floor(hours/24)+' hari '+hours%24+' jam'
  return hours ? hours+' jam' : Math.max(0,Math.floor(ms/60000))+' menit'
}

export default function CentralDashboard() {
  const orders=useAllOrders(), history=useProcessHistory(), status=useOnlineConnection()
  const [range,setRange]=useState(todayRange)
  const [now,setNow]=useState(()=>new Date())
  const [notice,setNotice]=useState('')
  const [attention,setAttention]=useState<'late'|'today'|'longest'>('late')
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState === 'visible')setNow(new Date())},30000)
    return ()=>window.clearInterval(timer)
  },[])
  const today=jakartaDate(now)
  const start=range.period==='today'?today:range.start
  const end=range.period==='today'?today:range.end
  const selectedBranch=status.branches?.find(branch=>branch.id===status.branchId)
  const scopeLabel=status.branchId ? `Cabang ${selectedBranch?.name ?? 'terpilih'}` : 'Semua cabang'
  const scopedOrders=useMemo(()=>status.branchId ? orders.filter(order=>order.branch_id===status.branchId) : orders,[orders,status.branchId])
  const saved=useDailySummary(start,end)
  const rawSummary=useMemo(()=>{
    const branches=(status.branches??[]).filter(branch=>!status.branchId||branch.id===status.branchId)
    return saved.enabled?centralDashboardLiveSummary(orders,branches,start,end,today):centralDashboardSummary(orders,history,branches,start,end,today)
  },[orders,history,status.branches,status.branchId,start,end,today,saved.enabled])
  const summary=useMemo(()=>saved.enabled?{...rawSummary,output:storedOutput(saved.rows),trend:storedTrend(saved.rows,start,end),rows:rawSummary.rows.map(row=>({...row,output:storedOutput(saved.rows,row.id),completed:total(saved.rows,'intake_completed',undefined,row.id).count}))}:rawSummary,[rawSummary,saved.enabled,saved.rows,start,end])
  const longest=useMemo(()=>longestPendingOrders(summary.pendingOrders,history,now),[summary.pendingOrders,history,now])
  const data={...summary,longest}
  const branchPaper=useMemo(()=>{
    if(saved.enabled)return Object.fromEntries(summary.rows.map(branch=>[branch.id,storedPaper(saved.rows,start,end,branch.id).totals]))
    const branchOrders = new Map<string, BoardOrder[]>()
    const branchEvents = new Map<string, ProcessEvent[]>()
    const orderBranches = new Map<string, string>()
    for (const order of orders) {
      if (!order.branch_id) continue
      orderBranches.set(order.id, order.branch_id)
      const rows = branchOrders.get(order.branch_id) ?? []
      rows.push(order); branchOrders.set(order.branch_id, rows)
    }
    for (const event of history) {
      const branch = orderBranches.get(event.orderId)
      if (!branch) continue
      const events = branchEvents.get(branch) ?? []
      events.push(event); branchEvents.set(branch, events)
    }
    return Object.fromEntries(summary.rows.map(branch=>[branch.id,paperOutput(branchOrders.get(branch.id) ?? [],branchEvents.get(branch.id) ?? [],start,end).totals]))
  },[summary.rows,orders,history,start,end,saved.enabled,saved.rows])
  const paperCharts=useMemo(()=><PaperOutput sharedGrid orders={scopedOrders} history={history} start={start} end={end} scope={scopeLabel} />,[scopedOrders,history,start,end,scopeLabel])
  const branchNames=new Map(status.branches?.map(branch=>[branch.id,branch.name]))
  const alertCount = attention==='late' ? data.overdue.length : attention==='today' ? data.dueToday.length : data.longest.length
  const alerts: {order:BoardOrder;note:string}[] = attention==='late'
    ? data.overdue.slice(0,5).map(order=>({order,note:'Tenggat '+shortDate(order.due_at)}))
    : attention==='today' ? data.dueToday.slice(0,5).map(order=>({order,note:'Tenggat '+shortDate(order.due_at)}))
    : data.longest.map(({order,milliseconds})=>({order,note:duration(milliseconds)+' di tahap ini'}))
  const openBranch=useCallback(async (id:string | null) => {
    try { await selectBranch(id) } catch { setNotice('Cabang belum dapat dibuka. Coba kembali.') }
  },[])
  function preset(kind:'week'|'month') {
    const weekday=new Date(today+'T12:00:00Z').getUTCDay()
    setRange({period:'custom',start:kind==='month'?today.slice(0,8)+'01':shiftDate(today,-((weekday+6)%7)),end:today})
  }
  if(saved.enabled&&(saved.loading||saved.error))return <div className="space-y-5"><DateRangeFilter value={{...range,start,end}} onChange={setRange}/><ReportStatus report={saved}/></div>
  return <div className="min-w-0 space-y-5 pb-4">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="page-title">{status.branchId ? `Pantau ${scopeLabel}` : 'Pantau seluruh cabang'}</h2>
      </div>
      {status.branchId && <button type="button" onClick={()=>void openBranch(null)} className="rounded-xl border border-brand-600 bg-white px-4 py-2.5 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50">Kembali ke seluruh cabang</button>}
    </header>
    {notice&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{notice}</p>}
    <section aria-label={`Periode output ${scopeLabel}`} className={panel+' flex flex-wrap items-center justify-between gap-3 p-4'}>
      <DateRangeFilter value={{...range,start,end}} onChange={setRange} />
      <div className="flex gap-2">
        <button type="button" onClick={()=>preset('week')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Minggu ini</button>
        <button type="button" onClick={()=>preset('month')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Bulan ini</button>
      </div>
    </section>
    <ReportStatus report={saved} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {([
        {label:'Output DTF',value:number.format(data.output.dtf.meter)+' meter',caption:data.output.dtf.count+' order selesai print',kind:'dtf'},
        {label:'Output Sublim',value:number.format(data.output.sublim.meter)+' meter',caption:data.output.sublim.count+' order selesai print',kind:'sublim'},
        {label:'Order dalam proses',value:number.format(data.pending),caption:'',kind:'pending'},
        {label:'Order terlambat',value:number.format(data.overdue.length),caption:'',kind:'late'},
      ]).map(card=><section key={card.kind} data-output={card.kind} className={panel+' daily-output-card p-5 '+(card.kind==='late'&&data.overdue.length?'border-red-200 bg-red-50':'')}>
        <h3 className="text-sm font-medium text-slate-500">{card.label}</h3>
        <p className={'mt-3 break-words text-3xl font-bold tracking-tight '+(card.kind==='late'&&data.overdue.length?'text-red-600':'text-slate-900')}>{card.value}</p>
        {card.caption && <p className="mt-2 text-xs leading-5 text-slate-500">{card.caption}</p>}
      </section>)}
    </div>
    <ProductivityReport orders={scopedOrders} history={history} start={start} end={end} scope={scopeLabel} />
    <CentralCharts data={summary} scope={scopeLabel} onBranch={openBranch}
      paperCharts={paperCharts}
      branchPaper={branchPaper}
    />
    <section className={panel}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><Building2 className="h-4 w-4 text-slate-500"/><h3 className="font-semibold text-slate-900">{status.branchId ? 'Ringkasan cabang' : 'Perbandingan cabang'}</h3></div>
      <div className="overflow-x-auto" tabIndex={0} aria-label={status.branchId ? "Tabel ringkasan cabang" : "Tabel perbandingan cabang"}>
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Cabang','Output DTF','Output Sublim','Dalam proses','Order selesai','Terlambat',''].map((label,i)=><th key={i} scope="col" className="px-5 py-3">{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(branch=><tr key={branch.id} className="border-t border-slate-100 hover:bg-slate-50">
            <th scope="row" className="px-5 py-4"><button type="button" onClick={()=>void openBranch(branch.id)} className="font-semibold text-slate-900 hover:text-brand-600">{branch.name}</button></th>
            <td className="px-5 py-4 font-semibold text-slate-900">{number.format(branch.output.dtf.meter)} m</td>
            <td className="px-5 py-4 font-semibold text-slate-900">{number.format(branch.output.sublim.meter)} m</td>
            <td className="px-5 py-4 text-slate-600">{branch.pending} order</td>
            <td className="px-5 py-4 font-semibold text-emerald-700">{branch.completed} order</td>
            <td className="px-5 py-4"><span className={'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold '+(branch.overdue?'bg-red-50 text-red-600':'bg-emerald-50 text-emerald-700')}>{branch.overdue>0&&<TriangleAlert className="h-3 w-3"/>}{branch.overdue?branch.overdue+' order':'Tidak ada'}</span></td>
            <td className="px-5 py-4"><button type="button" aria-label={'Buka cabang '+branch.name} onClick={()=>void openBranch(branch.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Buka <ArrowUpRight className="h-4 w-4"/></button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <div className="grid items-start gap-5">
      <section className={panel+' overflow-hidden'}>
        <div className="border-b border-slate-100 p-5">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900"><TriangleAlert className="h-4 w-4 text-amber-600"/>Perlu perhatian</h3>
          <div role="group" aria-label="Jenis perhatian" className="mt-4 flex flex-wrap gap-2">
            {([{id:'late',label:'Terlambat',count:data.overdue.length},{id:'today',label:'Tenggat dalam periode',count:data.dueToday.length},{id:'longest',label:'Terlama di tahap',count:data.longest.length}] as const).map(tab=><button key={tab.id} type="button" aria-pressed={attention===tab.id} onClick={()=>setAttention(tab.id)} className={'rounded-lg px-3 py-2 text-xs font-medium '+(attention===tab.id?'bg-brand-50 text-brand-700':'bg-slate-50 text-slate-600')}>{tab.label} ({tab.count})</button>)}
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {alerts.slice(0,5).map(({order,note})=><Link key={order.id} href={'/orders/'+order.id+'?from=dashboard'} className="flex items-start justify-between gap-3 px-5 py-4 hover:bg-slate-50">
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{order.spk_code} <span className="font-normal text-slate-500">/ {branchNames.get(order.branch_id!)}</span></p><p className="mt-1 truncate text-sm text-slate-600">{order.customer.name}</p><p className="mt-1 text-xs text-slate-500">{BOARD_STAGE_META[order.board_stage].name}</p></div>
            <span className={'shrink-0 text-right text-xs font-medium '+(attention==='late'?'text-red-600':'text-slate-600')}>{note}<ArrowUpRight className="ml-auto mt-2 h-4 w-4"/></span>
          </Link>)}
          {!alerts.length&&<p className="p-8 text-center text-sm text-slate-500">{attention==='late'?'Tidak ada order terlambat.':attention==='today'?'Tidak ada order jatuh tempo.':'Belum ada data durasi.'}</p>}
        </div>
        {alertCount>5&&<p className="px-5 pb-4 text-xs text-slate-500">5 dari {alertCount} order</p>}
      </section>

    </div>
  </div>
}
