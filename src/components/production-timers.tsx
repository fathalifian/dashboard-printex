'use client'

import { useSyncExternalStore } from 'react'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory } from '@/lib/production-board'
import { PROCESS_STAGES, jakartaDate, type ProcessStage } from '@/lib/process-metrics'
import { formatDuration, orderTiming } from '@/lib/process-timing'

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
  if(!detail)return <dl className="board-timer mt-3 rounded-xl border px-3 py-2.5 tabular-nums">
    {!timing.finished&&<div className="board-timer-row pb-2">
      <dt className="board-timer-label text-[11px] font-medium">Waktu di tahap ini</dt>
      <dd className="board-timer-value mt-0.5 text-xs font-bold leading-5">{current.visited?formatDuration(current.milliseconds):'Belum tercatat'}</dd>
    </div>}
    {(!hideTotal||timing.finished)&&<div className={!timing.finished?'board-timer-total border-t pt-2':undefined}>
      <dt className="board-timer-label text-[11px] font-medium">{timing.finished?'Total hingga diterima':'Total waktu order'}</dt>
      <dd className="board-timer-value mt-0.5 text-xs font-bold leading-5">{formatDuration(timing.totalMilliseconds)}</dd>
    </div>}
  </dl>
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Waktu Proses Order</h3>
    <p className="mt-2 text-lg font-bold text-blue-600 tabular-nums">Total: {formatDuration(timing.totalMilliseconds)}</p>
    <p className="mt-1 text-xs text-slate-500">{timing.finished?'Berhenti saat penerimaan/pengiriman dikonfirmasi.':'Masih berjalan sampai penerimaan/pengiriman dikonfirmasi.'} Durasi kalender, termasuk malam dan hari libur. Kunjungan ulang ke tahap yang sama dijumlahkan.</p>
    <div className="mt-4 divide-y divide-slate-100">{PROCESS_STAGES.filter(stage=>stage!=='archive').map(stage=>{
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
  const stageRows=timings.filter(({timing})=>stage==='archive'?timing.finished&&eligible(timing.receivedAt):timing.stages[stage].visited&&!timing.stages[stage].running&&eligible(timing.stages[stage].lastExit))
  const totals=timings.filter(({timing})=>timing.finished&&eligible(timing.receivedAt)&&timing.totalMilliseconds!==null)
  const average=stageRows.length?stageRows.reduce((sum,{timing})=>sum+(stage==='archive'?timing.totalMilliseconds??0:timing.stages[stage].milliseconds),0)/stageRows.length:null
  const totalAverage=totals.length?totals.reduce((sum,{timing})=>sum+(timing.totalMilliseconds??0),0)/totals.length:null
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Durasi Proses</h3>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">{stage==='archive'?'Rata-rata total hingga diterima':`Rata-rata ${BOARD_STAGE_META[stage].name}`}</p><p className="mt-1 text-xl font-bold text-blue-600">{average===null?'Belum ada sampel':formatDuration(average)}</p><p className="text-xs text-slate-500">{stageRows.length} order</p></div><div><p className="text-sm text-slate-500">Rata-rata total order hingga diterima</p><p className="mt-1 text-xl font-bold text-slate-900">{totalAverage===null?'Belum ada sampel':formatDuration(totalAverage)}</p><p className="text-xs text-slate-500">{totals.length} order diterima/dikirim pada periode ini</p></div></div>
    <p className="mt-4 text-xs text-slate-500">Rata-rata tahap menggunakan order yang sudah keluar dari tahap pada periode terpilih (tanggal keluar terakhir). Durasi kunjungan ulang dijumlahkan per order. Tahap yang dilewati dan order yang masih menjalani tahap tidak masuk rata-rata. Total berhenti saat konfirmasi penerimaan/pengiriman, bukan saat penyimpanan laporan arsip.</p>
    {!!stageRows.length&&<div className="mt-4 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="text-slate-500"><th className="py-2">SPK</th><th>Durasi tahap</th><th>Total order</th></tr></thead><tbody>{stageRows.map(({order,timing})=><tr key={order.id} className="border-t border-slate-100 text-slate-700"><td className="py-2">{order.spk_code}</td><td>{stage==='archive'?'Penerimaan tercatat':formatDuration(timing.stages[stage].milliseconds)}</td><td>{formatDuration(timing.totalMilliseconds)}{!timing.finished?' (berjalan)':''}</td></tr>)}</tbody></table></div>}
  </section>
}
