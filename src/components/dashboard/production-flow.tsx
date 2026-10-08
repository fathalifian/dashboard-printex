'use client'

import { useEffect, useMemo, useState } from 'react'
import { BOARD_STAGE_META, useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { createProductionFlowReader } from '@/lib/production-flow'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import { jakartaDate, type ProcessStage } from '@/lib/process-metrics'
import { useDailySummary, total, stageCode } from '@/lib/report-summaries'
import ReportStatus from '@/components/report-status'
import ProductionRoute from './production-route'

function duration(value: number | null) {
  if (value === null) return 'Belum tercatat'
  if (value < 60000) return '< 1 menit'
  const minutes = Math.floor(value / 60000)
  if (minutes < 60) return `${minutes} menit`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} jam ${minutes % 60} mnt`
  return `${Math.floor(minutes / 1440)} hari ${Math.floor(minutes % 1440 / 60)} jam`
}

export default function ProductionFlow({ selectedStage, onSelectStage }: { selectedStage: ProcessStage | 'all'; onSelectStage: (stage: ProcessStage | 'all') => void }) {
  const [range, setRange] = useState(todayRange)
  const orders = useAllOrders(), history = useProcessHistory(), connection = useOnlineConnection()
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 30000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [])
  const today = now ? jakartaDate(new Date(now)) : range.start
  const start = range.period === 'today' ? today : range.start
  const end = range.period === 'today' ? today : range.end
  const saved=useDailySummary(start,end)
  const readFlow = useMemo(() => createProductionFlowReader(orders, history, { start, end }), [orders, history, start, end])
  const rows = useMemo(() => readFlow(now).map(row=>{if(!saved.enabled)return row;const sum=total(saved.rows.filter(item=>item.dimension===stageCode(row.stage)),'flow');return {...row,samples:sum.count,total:sum.milliseconds,average:sum.count?sum.milliseconds/sum.count:null}}), [readFlow, now, saved.enabled, saved.rows])
  return <section aria-labelledby="production-flow-title" className="rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <h2 id="production-flow-title" className="font-semibold text-slate-900">Alur produksi</h2>
      <DateRangeFilter value={{ ...range, start, end }} onChange={setRange} />
    </div>
    <ReportStatus report={saved} />
    {connection.state !== 'ready' || !now ? <p role="status" className="p-8 text-center text-sm text-slate-500">{connection.state === 'error' ? 'Ringkasan belum tersedia. Periksa koneksi data.' : 'Memuat alur produksi...'}</p> :
      <ProductionRoute selectedStage={selectedStage} onSelectStage={onSelectStage} stops={rows.filter(row=>row.stage!=='archive').map(row => {
          const waiting = row.waiting.length ? row.waiting.reduce((sum, value) => sum + value, 0) / row.waiting.length : null
          return { stage: row.stage, name: BOARD_STAGE_META[row.stage].name, count: row.count + (row.stage==='done' ? rows.find(item=>item.stage==='archive')?.count ?? 0 : 0), samples: row.samples, average: duration(row.average), waiting: duration(waiting), bottleneck: row.bottleneck, piling: row.piling }
        })} />}
  </section>
}
