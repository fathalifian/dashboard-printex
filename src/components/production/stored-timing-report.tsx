'use client'

import { BOARD_STAGE_META } from '@/lib/production-board'
import { type ProcessStage } from '@/lib/process-metrics'
import { formatDuration } from '@/lib/process-timing'
import { useDailySummary, total, stageCode } from '@/lib/report-summaries'

export default function StoredTimingReport({stage,start,end}:{stage:ProcessStage;start:string;end:string}) {
  const saved=useDailySummary(start,end)
  const totalStage=stage==='incoming'||stage==='done'||stage==='archive'
  const metric=totalStage?'production':'timing'
  const dimension=totalStage?'':stageCode(stage)
  const stageTotal=total(saved.rows,metric,dimension)
  const production=total(saved.rows,'production')
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-slate-900">Durasi Proses</h3>
    <div className={totalStage?'mt-4':'mt-4 grid gap-4 sm:grid-cols-2'}>
      {!totalStage&&<div><p className="text-sm text-slate-500">Rata-rata {BOARD_STAGE_META[stage].name}</p><p className="mt-1 text-xl font-bold text-brand-600">{stageTotal.count?formatDuration(stageTotal.milliseconds/stageTotal.count):'Belum ada sampel'}</p><p className="text-xs text-slate-500">{stageTotal.count} order</p></div>}
      <div><p className="text-sm text-slate-500">Rata-rata total waktu produksi</p><p className="mt-1 text-xl font-bold text-brand-600">{production.count?formatDuration(production.milliseconds/production.count):'Belum ada sampel'}</p><p className="text-xs text-slate-500">{production.count} order selesai</p></div>
    </div>
  </section>
}
