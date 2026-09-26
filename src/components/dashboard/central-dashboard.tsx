'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Building2, Clock3, TriangleAlert } from 'lucide-react'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import { BOARD_STAGE_META, selectBranch, useAllOrders, useOnlineConnection, useProcessHistory, type BoardOrder } from '@/lib/production-board'
import { centralDashboard, shiftDate } from '@/lib/central-dashboard'
import { jakartaDate } from '@/lib/process-metrics'

const number = new Intl.NumberFormat('id-ID', {maximumFractionDigits:2})
const time = (value: string | number) => new Date(value).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'})
const shortDate = (value: string) => new Date(value+'T12:00:00Z').toLocaleDateString('id-ID',{day:'numeric',month:'short',timeZone:'UTC'})
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
    const timer=window.setInterval(()=>setNow(new Date()),30000)
    return ()=>window.clearInterval(timer)
  },[])
  const today=jakartaDate(now)
  const start=range.period==='today'?today:range.start
  const end=range.period==='today'?today:range.end
  const selectedBranch=status.branches?.find(branch=>branch.id===status.branchId)
  const scopeLabel=status.branchId ? `Cabang ${selectedBranch?.name ?? 'terpilih'}` : 'Semua cabang'
  const data=useMemo(()=>centralDashboard(orders,history,
    (status.branches??[]).filter(branch=>!status.branchId || branch.id===status.branchId),start,end,now),
    [orders,history,status.branches,status.branchId,start,end,now])
  const branchNames=new Map(status.branches?.map(branch=>[branch.id,branch.name]))
  const scale=Math.max(1,...data.trend.flatMap(day=>[day.dtf.meter,day.sublim.meter]))
  const alerts: {order:BoardOrder;note:string}[] = attention==='late'
    ? data.overdue.map(order=>({order,note:'Tenggat '+shortDate(order.due_at)}))
    : attention==='today' ? data.dueToday.map(order=>({order,note:'Tenggat hari ini'}))
    : data.longest.map(({order,milliseconds})=>({order,note:duration(milliseconds)+' di tahap ini'}))
  async function openBranch(id:string | null) {
    try { await selectBranch(id) } catch { setNotice('Cabang belum dapat dibuka. Coba kembali.') }
  }
  function preset(kind:'week'|'month') {
    const weekday=new Date(today+'T12:00:00Z').getUTCDay()
    setRange({period:'custom',start:kind==='month'?today.slice(0,8)+'01':shiftDate(today,-((weekday+6)%7)),end:today})
  }
  return <div className="space-y-5 pb-4">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Owner Pusat</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{status.branchId ? `Pantau ${scopeLabel}` : 'Pantau seluruh cabang'}</h2>
        <p className="mt-1 text-sm text-slate-500">{status.branchId ? `Ringkasan operasional ${scopeLabel}.` : `${data.rows.length} cabang dalam satu tampilan.`}</p>
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {([
        {label:'Output DTF',value:number.format(data.output.dtf.meter)+' meter',caption:data.output.dtf.count+' order selesai print',kind:'dtf'},
        {label:'Output Sublim',value:number.format(data.output.sublim.meter)+' meter',caption:data.output.sublim.count+' order selesai print',kind:'sublim'},
        {label:'Order dalam proses',value:number.format(data.pending),caption:'Posisi saat ini / Belum selesai produksi',kind:'pending'},
        {label:'Order terlambat',value:number.format(data.overdue.length),caption:'Posisi saat ini / Melewati tenggat',kind:'late'},
      ]).map(card=><section key={card.kind} data-output={card.kind} className={panel+' daily-output-card p-5 '+(card.kind==='late'&&data.overdue.length?'border-red-200 bg-red-50':'')}>
        <h3 className="text-sm font-medium text-slate-500">{card.label}</h3>
        <p className={'mt-3 break-words text-3xl font-bold tracking-tight '+(card.kind==='late'&&data.overdue.length?'text-red-600':'text-slate-900')}>{card.value}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{card.caption}</p>
      </section>)}
    </div>
    <section className={panel}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><Building2 className="h-4 w-4 text-slate-500"/><h3 className="font-semibold text-slate-900">{status.branchId ? 'Ringkasan cabang' : 'Perbandingan cabang'}</h3></div>
      <div className="overflow-x-auto" tabIndex={0} aria-label={status.branchId ? "Tabel ringkasan cabang" : "Tabel perbandingan cabang"}>
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Cabang','Output DTF','Output Sublim','Dalam proses','Terlambat',''].map((label,i)=><th key={i} scope="col" className="px-5 py-3">{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(branch=><tr key={branch.id} className="border-t border-slate-100 hover:bg-slate-50">
            <th scope="row" className="px-5 py-4"><button type="button" onClick={()=>void openBranch(branch.id)} className="font-semibold text-slate-900 hover:text-brand-600">{branch.name}</button></th>
            <td className="px-5 py-4 font-semibold text-slate-900">{number.format(branch.output.dtf.meter)} m</td>
            <td className="px-5 py-4 font-semibold text-slate-900">{number.format(branch.output.sublim.meter)} m</td>
            <td className="px-5 py-4 text-slate-600">{branch.pending} order</td>
            <td className="px-5 py-4"><span className={'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold '+(branch.overdue?'bg-red-50 text-red-600':'bg-emerald-50 text-emerald-700')}>{branch.overdue>0&&<TriangleAlert className="h-3 w-3"/>}{branch.overdue?branch.overdue+' order':'Tidak ada'}</span></td>
            <td className="px-5 py-4"><button type="button" aria-label={'Buka cabang '+branch.name} onClick={()=>void openBranch(branch.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Buka <ArrowUpRight className="h-4 w-4"/></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Output mengikuti periode terpilih. Dalam proses dan terlambat menunjukkan posisi saat ini.</p>
    </section>
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <section className={panel+' overflow-hidden'}>
        <div className="border-b border-slate-100 p-5">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900"><TriangleAlert className="h-4 w-4 text-amber-600"/>Perlu perhatian</h3>
          <p className="mt-1 text-xs text-slate-500">Posisi saat ini, {status.branchId ? `di ${scopeLabel}` : 'di seluruh cabang'}.</p>
          <div role="group" aria-label="Jenis perhatian" className="mt-4 flex flex-wrap gap-2">
            {([{id:'late',label:'Terlambat',count:data.overdue.length},{id:'today',label:'Tenggat hari ini',count:data.dueToday.length},{id:'longest',label:'Terlama di tahap',count:data.longest.length}] as const).map(tab=><button key={tab.id} type="button" aria-pressed={attention===tab.id} onClick={()=>setAttention(tab.id)} className={'rounded-lg px-3 py-2 text-xs font-medium '+(attention===tab.id?'bg-brand-50 text-brand-700':'bg-slate-50 text-slate-600')}>{tab.label} ({tab.count})</button>)}
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {alerts.slice(0,5).map(({order,note})=><Link key={order.id} href={'/orders/'+order.id+'?from=dashboard'} className="flex items-start justify-between gap-3 px-5 py-4 hover:bg-slate-50">
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{order.spk_code} <span className="font-normal text-slate-500">/ {branchNames.get(order.branch_id!)}</span></p><p className="mt-1 truncate text-sm text-slate-600">{order.customer.name}</p><p className="mt-1 text-xs text-slate-500">{BOARD_STAGE_META[order.board_stage].name}</p></div>
            <span className={'shrink-0 text-right text-xs font-medium '+(attention==='late'?'text-red-600':'text-slate-600')}>{note}<ArrowUpRight className="ml-auto mt-2 h-4 w-4"/></span>
          </Link>)}
          {!alerts.length&&<p className="p-8 text-center text-sm text-slate-500">{attention==='late'?'Tidak ada order terlambat.':attention==='today'?'Tidak ada order belum selesai yang jatuh tempo hari ini.':'Belum ada durasi tahap yang dapat ditampilkan.'}</p>}
        </div>
        {alerts.length>5&&<p className="px-5 pb-4 text-xs text-slate-500">Menampilkan 5 dari {alerts.length} order. Buka Board Produksi untuk melihat seluruh order.</p>}
      </section>
      <section className={panel+' p-5'}>
        <h3 className="font-semibold text-slate-900">Tren output print</h3>
        <p className="mt-1 text-xs text-slate-500">7 hari sampai {shortDate(end)} / {scopeLabel} / meter</p>
        <div className="mt-4 flex gap-4 text-xs text-slate-600"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded bg-indigo-500"/>DTF</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded bg-amber-500"/>Sublim</span></div>
        <div className="mt-5 grid grid-cols-7 gap-2" role="img" aria-label="Grafik output DTF dan Sublim tujuh hari. Angka lengkap tersedia pada rincian di bawah.">
          {data.trend.map(day=><div key={day.day} className="min-w-0">
            <div className="flex h-40 items-end justify-center gap-1 border-b border-slate-200">
              {(['dtf','sublim'] as const).map(kind=><div key={kind} title={shortDate(day.day)+': '+kind.toUpperCase()+' '+number.format(day[kind].meter)+' meter'} className={'w-5 max-w-[45%] rounded-t '+(kind==='dtf'?'bg-indigo-500':'bg-amber-500')} style={{height:day[kind].meter?Math.max(2,day[kind].meter/scale*100)+'%':'0%'}}/>)}
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-500">{day.day.slice(8)}/{day.day.slice(5,7)}</p>
          </div>)}
        </div>
        {data.trend.every(day=>!day.dtf.meter&&!day.sublim.meter)&&<p className="mt-3 text-center text-xs text-slate-500">Belum ada output print pada tujuh hari ini.</p>}
        <details className="mt-4 text-xs text-slate-600"><summary className="cursor-pointer py-1 font-medium">Lihat angka harian</summary><table className="mt-2 w-full text-left"><thead><tr><th className="py-2">Tanggal</th><th>DTF (m)</th><th>Sublim (m)</th></tr></thead><tbody>{data.trend.map(day=><tr key={day.day} className="border-t border-slate-100"><td className="py-2">{shortDate(day.day)}</td><td>{number.format(day.dtf.meter)}</td><td>{number.format(day.sublim.meter)}</td></tr>)}</tbody></table></details>
      </section>
    </div>
    <section className={panel}>
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="flex items-center gap-2 font-semibold text-slate-900"><Clock3 className="h-4 w-4 text-slate-500"/>Aktivitas terbaru</h3><p className="mt-1 text-xs text-slate-500">Delapan aktivitas terakhir pada periode terpilih.</p></div>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2">
        {data.activity.map(item=><div key={item.id} className="flex gap-3 p-5">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"/>
          <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{item.label} <span className="font-normal text-slate-500">/ {item.branch}</span></p>
            {item.orderId?<Link href={'/orders/'+item.orderId+'?from=dashboard'} className="mt-1 inline-block text-sm font-medium text-brand-600">{item.spk}</Link>:<p className="text-sm text-slate-600">{item.spk}</p>}
            <p className="mt-1 text-xs text-slate-500">{shortDate(jakartaDate(item.at))}, {time(item.at)} WIB{item.actor?' / '+item.actor:''}</p>
          </div>
        </div>)}
        {!data.activity.length&&<p className="p-8 text-center text-sm text-slate-500 sm:col-span-2">Belum ada aktivitas pada periode ini.</p>}
      </div>
    </section>
  </div>
}
