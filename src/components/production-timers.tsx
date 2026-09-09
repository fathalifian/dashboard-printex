'use client'

import { useSyncExternalStore } from 'react'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory } from '@/lib/production-board'
import { jakartaDate, type ProcessStage } from '@/lib/process-metrics'
import { formatDuration, orderTiming, TIMED_STAGES } from '@/lib/process-timing'

let now=0
const listeners=new Set<()=>void>()
let timer:ReturnType<typeof setInterval>|undefined
function subscribe(listener:()=>void) {
  listeners.add(listener)
  if(!timer){now=Date.now();timer=setInterval(()=>{now=Date.now();listeners.forEach(fn=>fn())},1000)}
  return ()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);timer=undefined}}
}
function useClock(){return useSyncExternalStore(subscribe,()=>now,()=>0)}

export function OrderTimer({id,detail=false,hideTotal=false}:{id:string;detail?:boolean;hideTotal?:boolean}) {
  const orders=useAllOrders(), history=useProcessHistory(), clock=useClock()
  const order=orders.find(row=>row.id===id)
  if(!order||!clock)return null
  const timing=orderTiming(order,history,clock)
  const current=timing.stages[order.board_stage]
  if(!detail && order.board_stage==='incoming')return <p className="mt-3 text-xs text-slate-500">Waktu produksi belum dimulai</p>
  if(!detail)return <dl className="board-timer mt-3 rounded-xl border px-3 py-2.5 tabular-nums">
    {!timing.finished&&<div className="board-timer-row pb-2">
      <dt className="board-timer-label text-[11px] font-medium">Waktu di tahap ini</dt>
      <dd className="board-timer-value mt-0.5 text-xs font-bold leading-5">{current.visited?formatDuration(current.milliseconds):'Belum tercatat'}</dd>
    </div>}
    {(!hideTotal||timing.finished)&&<div className={!timing.finished?'board-timer-total border-t pt-2':undefined}>
      <dt className="board-timer-label text-[11px] font-medium">{timing.finished?'Total waktu produksi':'Total produksi berjalan'}</dt>
      <dd className="board-timer-value mt-0.5 text-xs font-bold leading-5">{formatDuration(timing.totalMilliseconds)}</dd>
    </div>}
  </dl>
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Waktu Proses Order</h3>
    <p className="mt-2 text-lg font-bold text-blue-600 tabular-nums">Total: {formatDuration(timing.totalMilliseconds)}</p>
    <p className="mt-1 text-xs text-slate-500">{timing.finished?'Berhenti saat pertama masuk Order Selesai.':timing.startedAt?'Berjalan sejak masuk Desain atau Menunggu Pembayaran hingga Order Selesai.':'Belum ada catatan masuk Desain atau Menunggu Pembayaran.'} Durasi kalender, termasuk malam dan hari libur. Kunjungan ulang ke tahap yang sama dijumlahkan.</p>
    <div className="mt-4 divide-y divide-slate-100">{TIMED_STAGES.map(stage=>{
      const row=timing.stages[stage]
      return <div key={stage} className="flex justify-between gap-4 py-3 text-sm"><span className="text-slate-600">{BOARD_STAGE_META[stage].name}{row.running?' (berjalan)':''}</span><span className="text-right font-medium text-slate-900 tabular-nums">{row.visited?formatDuration(row.milliseconds):'Tidak dilalui / belum tercatat'}</span></div>
    })}</div>
  </section>
}

export function ProcessTimingReport({stage,start,end}:{stage:ProcessStage;start:string;end:string}) {
  const orders=useAllOrders(),history=useProcessHistory(),clock=useClock()
  if(!clock)return null
  const timings=orders.map(order=>({order,timing:orderTiming(order,history,clock)}))
  const eligible=(at:string|null)=>!!at&&jakartaDate(at)>=start&&jakartaDate(at)<=end
  const totalStage=stage==='incoming'||stage==='done'||stage==='archive'
  const stageRows=timings.filter(({timing})=>totalStage?timing.finished&&timing.totalMilliseconds!==null&&eligible(timing.completedAt):timing.stages[stage].visited&&!timing.stages[stage].running&&eligible(timing.stages[stage].lastExit))
  const totals=timings.filter(({timing})=>timing.finished&&eligible(timing.completedAt)&&timing.totalMilliseconds!==null)
  const average=stageRows.length?stageRows.reduce((sum,{timing})=>sum+(totalStage?timing.totalMilliseconds??0:timing.stages[stage].milliseconds),0)/stageRows.length:null
  const totalAverage=totals.length?totals.reduce((sum,{timing})=>sum+(timing.totalMilliseconds??0),0)/totals.length:null
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Durasi Proses</h3>
    <div className={totalStage?'mt-4':'mt-4 grid gap-4 sm:grid-cols-2'}>
      {!totalStage&&<div><p className="text-sm text-slate-500">Rata-rata {BOARD_STAGE_META[stage].name}</p><p className="mt-1 text-xl font-bold text-blue-600">{average===null?'Belum ada sampel':formatDuration(average)}</p><p className="text-xs text-slate-500">{stageRows.length} order</p></div>}
      <div><p className="text-sm text-slate-500">Rata-rata total waktu produksi</p><p className="mt-1 text-xl font-bold text-blue-600">{totalAverage===null?'Belum ada sampel':formatDuration(totalAverage)}</p><p className="text-xs text-slate-500">{totals.length} order masuk Order Selesai pada periode ini</p></div>
    </div>
    {!!stageRows.length&&<details key={stage+start+end} className="group mt-4 border-t border-slate-100 pt-3">
      <summary className="list-none cursor-pointer text-sm font-semibold text-blue-600 [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">Buka rincian order ({stageRows.length})</span><span className="hidden group-open:inline">Tutup rincian order</span></summary>
      <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="text-slate-500"><th className="py-2">SPK</th>{!totalStage&&<th>Durasi tahap</th>}<th>Total produksi</th></tr></thead><tbody>{stageRows.map(({order,timing})=><tr key={order.id} className="border-t border-slate-100 text-slate-700"><td className="py-2">{order.spk_code}</td>{!totalStage&&<td>{formatDuration(timing.stages[stage].milliseconds)}</td>}<td>{formatDuration(timing.totalMilliseconds)}{!timing.finished?' (berjalan)':''}</td></tr>)}</tbody></table></div>
    </details>}
  </section>
}
