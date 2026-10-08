'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory, useOnlineConnection, type BoardOrder } from '@/lib/production-board'
import { jakartaDate, type ProcessEvent, type ProcessStage } from '@/lib/process-metrics'
import { formatDuration, orderTiming, createOrderTimingReader, TIMED_STAGES } from '@/lib/process-timing'
import StoredTimingReport from './stored-timing-report'

let now=0
const listeners=new Set<()=>void>()
let timer:ReturnType<typeof setInterval>|undefined
function subscribe(listener:()=>void) {
  listeners.add(listener)
  if(!timer){now=Date.now();timer=setInterval(()=>{if(document.visibilityState !== 'visible')return;now=Date.now();listeners.forEach(fn=>fn())},1000)}
  return ()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);timer=undefined}}
}
const idleSubscribe = () => () => {}
function useClock(active = true){return useSyncExternalStore(active ? subscribe : idleSubscribe,()=>active ? now : 0,()=>0)}

// Online snapshots replace their arrays. Share an index across cards instead of
// scanning every order's complete history separately on each render.
const historyIndexes = new WeakMap<ProcessEvent[], Map<string, ProcessEvent[]>>()
const emptyEvents: ProcessEvent[] = []
const orderIndexes = new WeakMap<BoardOrder[], Map<string, BoardOrder>>()
function orderIndex(orders: BoardOrder[]) {
  let index = orderIndexes.get(orders)
  if (!index) { index = new Map(orders.map(order => [order.id, order])); orderIndexes.set(orders, index) }
  return index
}
let previousIndex = new Map<string, ProcessEvent[]>()
function historyIndex(history: ProcessEvent[]) {
  let index = historyIndexes.get(history)
  if (!index) {
    index = new Map()
    for (const event of history) {
      const events = index.get(event.orderId)
      if (events) events.push(event)
      else index.set(event.orderId, [event])
    }
    for (const [id, events] of index) {
      const previous = previousIndex.get(id)
      if (previous?.length === events.length && events.every((event, i) => event === previous[i])) index.set(id, previous)
    }
    previousIndex = index
    historyIndexes.set(history, index)
  }
  return index
}

export function OrderTimer({id,detail=false,hideTotal=false}:{id:string;detail?:boolean;hideTotal?:boolean}) {
  const orders=useAllOrders(), history=useProcessHistory()
  const order=orderIndex(orders).get(id)
  const orderEvents=historyIndex(history).get(id) ?? emptyEvents
  const reader=useMemo(()=>order ? createOrderTimingReader(order,orderEvents) : null,[order,orderEvents])
  const baseline=useMemo(()=>reader?.(0),[reader])
  const clock=useClock(!!baseline?.startedAt && !baseline.finished)
  if(!order||!reader)return null
  const timing=reader(clock)
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
    <p className="mt-2 text-lg font-bold text-brand-600 tabular-nums">Total: {formatDuration(timing.totalMilliseconds)}</p>
    <div className="mt-4 divide-y divide-slate-100">{TIMED_STAGES.map(stage=>{
      const row=timing.stages[stage]
      return <div key={stage} className="flex justify-between gap-4 py-3 text-sm"><span className="text-slate-600">{BOARD_STAGE_META[stage].name}{row.running?' (berjalan)':''}</span><span className="text-right font-medium text-slate-900 tabular-nums">{row.visited?formatDuration(row.milliseconds):'Tidak dilalui / belum tercatat'}</span></div>
    })}</div>
  </section>
}

export function ProcessTimingReport({stage,start,end}:{stage:ProcessStage;start:string;end:string}) {
  const status=useOnlineConnection()
  return status.reportSummariesEnabled?<StoredTimingReport key={stage+start+end} stage={stage} start={start} end={end}/>:<RawTimingReport stage={stage} start={start} end={end}/>
}
function RawTimingReport({stage,start,end}:{stage:ProcessStage;start:string;end:string}) {
  const connection=useOnlineConnection()
  const orders=useAllOrders(),history=useProcessHistory()
  const indexed=historyIndex(history)
  const timings=useMemo(()=>{
    const at=history.reduce((latest,event)=>Math.max(latest,Number.isFinite(Date.parse(event.occurredAt)) ? Date.parse(event.occurredAt) : 0),0)
    return orders.map(order=>({order,timing:orderTiming(order,indexed.get(order.id) ?? emptyEvents,at)}))
  },[orders,history,indexed])
  const eligible=(at:string|null)=>!!at&&jakartaDate(at)>=start&&jakartaDate(at)<=end
  const totalStage=stage==='incoming'||stage==='done'||stage==='archive'
  const stageRows=timings.filter(({timing})=>totalStage?timing.finished&&timing.totalMilliseconds!==null&&eligible(timing.completedAt):timing.stages[stage].visited&&!timing.stages[stage].running&&eligible(timing.stages[stage].lastExit))
  const totals=timings.filter(({timing})=>timing.finished&&eligible(timing.completedAt)&&timing.totalMilliseconds!==null)
  const average=stageRows.length?stageRows.reduce((sum,{timing})=>sum+(totalStage?timing.totalMilliseconds??0:timing.stages[stage].milliseconds),0)/stageRows.length:null
  const totalAverage=totals.length?totals.reduce((sum,{timing})=>sum+(timing.totalMilliseconds??0),0)/totals.length:null
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Durasi Proses</h3>
    <div className={totalStage?'mt-4':'mt-4 grid gap-4 sm:grid-cols-2'}>
      {!totalStage&&<div><p className="text-sm text-slate-500">Rata-rata {BOARD_STAGE_META[stage].name}</p><p className="mt-1 text-xl font-bold text-brand-600">{average===null?'Belum ada sampel':formatDuration(average)}</p><p className="text-xs text-slate-500">{stageRows.length} order</p></div>}
      <div><p className="text-sm text-slate-500">Rata-rata total waktu produksi</p><p className="mt-1 text-xl font-bold text-brand-600">{totalAverage===null?'Belum ada sampel':formatDuration(totalAverage)}</p><p className="text-xs text-slate-500">{totals.length} order selesai</p></div>
    </div>
    {!!stageRows.length&&<details key={stage+start+end} className="group mt-4 border-t border-slate-100 pt-3">
      <summary className="list-none cursor-pointer text-sm font-semibold text-brand-600 [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">Buka rincian order ({stageRows.length})</span><span className="hidden group-open:inline">Tutup rincian order</span></summary>
      <TimingDetailsTable stageRows={stageRows} totalStage={totalStage} stage={stage} connection={connection} indexed={indexed} />
    </details>}
  </section>
}

function TimingDetailsTable({ stageRows, totalStage, stage, connection, indexed }: {
  stageRows: Array<{ order: BoardOrder; timing: ReturnType<typeof orderTiming> }>
  totalStage: boolean
  stage: ProcessStage
  connection: ReturnType<typeof useOnlineConnection>
  indexed: Map<string, ProcessEvent[]>
}) {
  const [page, setPage] = useState(1)
  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(stageRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedRows = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize
    return stageRows.slice(startIdx, startIdx + pageSize)
  }, [stageRows, currentPage, pageSize])
  const branchMap = useMemo(() => new Map((connection.branches ?? []).map(b => [b.id, b.name])), [connection.branches])

  return (
    <div className="mt-3 max-h-80 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-slate-500">
            <th className="py-2">SPK</th>
            <th>Cabang</th>
            {!totalStage && <th>Durasi tahap</th>}
            <th>Total produksi</th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.map(({ order, timing }) => (
            <tr key={order.id} className="border-t border-slate-100 text-slate-700">
              <td className="py-2">{order.spk_code}</td>
              <td>{(order.branch_id ? branchMap.get(order.branch_id) : undefined) ?? 'Belum tercatat'}</td>
              {!totalStage && <td>{formatDuration(timing.stages[stage].milliseconds)}</td>}
              <td><ReportTotal order={order} events={indexed.get(order.id) ?? emptyEvents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-2 text-xs text-slate-500">
          <span>Menampilkan {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, stageRows.length)} dari {stageRows.length} order</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((p: number) => Math.max(1, p - 1))} className="rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">Sebelumnya</button>
            <span>Hal {currentPage} dari {totalPages}</span>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} className="rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">Berikutnya</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReportTotal({order,events}:{order:BoardOrder;events:ProcessEvent[]}) {
  const reader=useMemo(()=>createOrderTimingReader(order,events),[order,events])
  const baseline=useMemo(()=>reader(0),[reader])
  const clock=useClock(!baseline.finished && !!baseline.startedAt)
  const timing=reader(clock)
  return <>{formatDuration(timing.totalMilliseconds)}{!timing.finished?' (berjalan)':''}</>
}
