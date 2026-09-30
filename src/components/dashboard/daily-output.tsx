'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { jakartaDate } from '@/lib/process-metrics'
import { outputForCompletions, printCompletions } from '@/lib/daily-output'
import { shiftDate } from '@/lib/central-dashboard'
import CentralCharts from '@/components/dashboard/central-charts'
import PaperOutput from '@/components/dashboard/paper-output'
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
  const scopedOrders = useMemo(() => connection.branchId ? orders.filter(order => order.branch_id === connection.branchId) : orders, [orders, connection.branchId])
  const scope = connection.branches?.find(branch => branch.id === connection.branchId)?.name ?? 'Cabang aktif'
  const data = useMemo(() => {
    const completions = printCompletions(history)
    const output = outputForCompletions(scopedOrders, completions, start, end)
    const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1)
    const trend = Array.from({ length: days }, (_, index) => {
      const day = shiftDate(start, index)
      return { day, ...outputForCompletions(scopedOrders, completions, day, day) }
    })
    const pending = scopedOrders.filter(order => order.order_date >= start && order.order_date <= end && order.order_state !== 'completed' && order.order_state !== 'cancelled' && !order.archive?.finalizedAt)
    return { output, trend, rows: [], pending: pending.length, overdue: pending.filter(order => order.due_at && order.due_at < today).length }
  }, [scopedOrders, history, start, end, today])

  return <section aria-labelledby="daily-output-title" className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div>
        <h2 id="daily-output-title" className="font-semibold text-slate-900">Output print harian</h2>
      </div>
      <DateRangeFilter value={{ ...range, start, end }} onChange={setRange} />
    </div>
    {connection.state !== 'ready' || !today ? <p role="status" className="p-8 text-center text-sm text-slate-500">{connection.state === 'error' ? 'Output belum tersedia. Periksa koneksi data.' : 'Memuat output harian...'}</p> :
      <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite">
        {([
          { key: 'dtf', title: 'Output DTF', value: number.format(data.output.dtf.meter) + ' meter', caption: data.output.dtf.count + ' order selesai print' },
          { key: 'sublim', title: 'Output Sublim', value: number.format(data.output.sublim.meter) + ' meter', caption: data.output.sublim.count + ' order selesai print' },
          { key: 'pending', title: 'Order dalam proses', value: number.format(data.pending), caption: 'Order masuk periode terpilih / Belum selesai saat ini' },
          { key: 'late', title: 'Order terlambat', value: number.format(data.overdue), caption: 'Order masuk periode terpilih / Terlambat saat ini' },
        ]).map(card => <div key={card.key} data-output={card.key} className={'daily-output-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm' + (card.key === 'late' && data.overdue ? ' border-red-200 bg-red-50' : '')}>
          <h3 className="text-sm font-medium text-slate-500">{card.title}</h3>
          <p className={'mt-3 break-words text-3xl font-bold tracking-tight ' + (card.key === 'late' && data.overdue ? 'text-red-600' : 'text-slate-900')}>{card.value}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{card.caption}</p>
        </div>)}
      </div>
      <CentralCharts data={data} scope={scope} paperCharts={<PaperOutput orders={scopedOrders} history={history} start={start} end={end} scope={scope} />} /></>}
  </section>
}
