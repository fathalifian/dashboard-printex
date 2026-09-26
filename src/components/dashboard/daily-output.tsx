'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { jakartaDate } from '@/lib/process-metrics'
import { dailyOutput } from '@/lib/daily-output'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 })

export default function DailyOutput() {
  const orders = useAllOrders(), history = useProcessHistory(), connection = useOnlineConnection()
  const [today, setToday] = useState('')
  const [range, setRange] = useState(todayRange)
  useEffect(() => {
    const tick = () => setToday(jakartaDate(new Date()))
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 30000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [])
  const start = range.period === 'today' ? today || range.start : range.start
  const end = range.period === 'today' ? today || range.end : range.end
  const totals = useMemo(() => dailyOutput(orders, history, start, end), [orders, history, start, end])

  return <section aria-labelledby="daily-output-title" className="rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 id="daily-output-title" className="font-semibold text-slate-900">Output print harian</h2>
      </div>
      <DateRangeFilter value={{ ...range, start, end }} onChange={setRange} />
    </div>
    {connection.state !== 'ready' || !today ? <p role="status" className="p-8 text-center text-sm text-slate-500">{connection.state === 'error' ? 'Output belum tersedia. Periksa koneksi data.' : 'Memuat output harian...'}</p> :
      <div className="grid gap-4 p-5 sm:grid-cols-2" aria-live="polite">
        {([
          { key: 'dtf', title: 'Output DTF', color: 'bg-violet-50 border-violet-100' },
          { key: 'sublim', title: 'Output Sublim', color: 'bg-amber-50 border-amber-100' },
        ] as const).map(category => <div key={category.key} data-output={category.key} className={`daily-output-card rounded-xl border p-5 ${category.color}`}>
          <h3 className="text-sm font-semibold text-slate-900">{category.title}</h3>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{number.format(totals[category.key].meter)} meter</p>
          <p className="mt-1 text-sm text-slate-600">{totals[category.key].count} order selesai print</p>
        </div>)}
      </div>}
  </section>
}
