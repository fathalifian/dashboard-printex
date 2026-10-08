'use client'

import { useState } from 'react'
import { BOARD_STAGE_META, useOnlineConnection } from '@/lib/production-board'
import { type ProcessStage } from '@/lib/process-metrics'
import { formatDuration } from '@/lib/process-timing'
import { useDailySummary, useReportDetails, total, stageCode } from '@/lib/report-summaries'
import ReportStatus from './report-status'

export default function StoredTimingReport({stage,start,end}:{stage:ProcessStage;start:string;end:string}) {
  const saved=useDailySummary(start,end)
  const connection=useOnlineConnection()
  const [open,setOpen]=useState(false)
  const [page,setPage]=useState(1)
  const totalStage=stage==='incoming'||stage==='done'||stage==='archive'
  const metric=totalStage?'production':'timing'
  const dimension=totalStage?'':stageCode(stage)
  const stageTotal=total(saved.rows,metric,dimension)
  const production=total(saved.rows,'production')
  const details=useReportDetails(start,end,metric,dimension,page,'',open&&!saved.loading&&!saved.error)
  const pages=Math.max(1,Math.ceil(details.total/50))
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Durasi Proses</h3>
    <div className={totalStage?'mt-4':'mt-4 grid gap-4 sm:grid-cols-2'}>
      {!totalStage&&<div><p className="text-sm text-slate-500">Rata-rata {BOARD_STAGE_META[stage].name}</p><p className="mt-1 text-xl font-bold text-brand-600">{stageTotal.count?formatDuration(stageTotal.milliseconds/stageTotal.count):'Belum ada sampel'}</p><p className="text-xs text-slate-500">{stageTotal.count} order</p></div>}
      <div><p className="text-sm text-slate-500">Rata-rata total waktu produksi</p><p className="mt-1 text-xl font-bold text-brand-600">{production.count?formatDuration(production.milliseconds/production.count):'Belum ada sampel'}</p><p className="text-xs text-slate-500">{production.count} order selesai</p></div>
    </div>
    {!!stageTotal.count&&<details className="mt-4 border-t border-slate-100 pt-3" onToggle={event=>setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold text-brand-600">Rincian order ({stageTotal.count})</summary>
      {open&&<><ReportStatus report={details}/><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-slate-500"><th className="py-2">SPK</th><th>Cabang</th>{!totalStage&&<th>Durasi tahap</th>}<th>Total produksi</th></tr></thead><tbody>{details.items.map(item=><tr key={item.order?.id} className="border-t border-slate-100 text-slate-700"><td className="py-2">{item.order?.spk_code}</td><td>{connection.branches?.find(branch=>branch.id===item.order?.branch_id)?.name??'Belum tercatat'}</td>{!totalStage&&<td>{formatDuration(item.milliseconds)}</td>}<td>{formatDuration(item.productionMilliseconds??null)}</td></tr>)}</tbody></table></div>{pages>1&&<div className="mt-3 flex items-center gap-3 text-xs"><button disabled={page<=1||details.loading} onClick={()=>setPage(value=>value-1)}>Sebelumnya</button><span>Hal {page} dari {pages}</span><button disabled={page>=pages||details.loading} onClick={()=>setPage(value=>value+1)}>Berikutnya</button></div>}</>}
    </details>}
  </section>
}
