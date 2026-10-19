'use client'

import { useMemo, useState } from 'react'
import ReportStatus from '@/components/reports/report-status'
import { useDailySummary, total, storedOutput, stageCode, storedEvent, exportReportDetails } from '@/lib/report-summaries'
import DateRangeFilter, { todayRange, type DateRange } from '@/components/ui/date-range-filter'
import { ProcessTimingReport } from '@/components/production/production-timers'
import { dailyOutput } from '@/lib/daily-output'
import { ChartColumn, Download } from 'lucide-react'
import { TrendChart } from '@/components/dashboard/fit-charts'
import { EmptyState } from '@/components/dashboard/fit'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory } from '@/lib/production-board'
import { jakartaDate, BOARD_STAGES, summarizeEvents, completionReportEvents, type ProcessStage } from '@/lib/process-metrics'

function shiftDay(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+07:00`)
  value.setUTCDate(value.getUTCDate() + amount)
  return jakartaDate(value)
}
const fieldClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700'
const eventLabel = (kind: string) => kind === 'completed' ? 'Selesai' : 'Masuk'

function ProcessReportDetail({ range, onRangeChange }: { range: DateRange; onRangeChange: (r: DateRange) => void }) {
  const orders = useAllOrders()
  const history = useProcessHistory()
  const [stage, setStage] = useState<ProcessStage>('incoming')

  const { start, end } = range
  const isArchive = stage === 'archive'
  const invalid = !start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92
  const saved=useDailySummary(start,end)
  const [exporting,setExporting]=useState(false)
  const [exportError,setExportError]=useState('')
  const source = useMemo(() => completionReportEvents(history, orders), [history, orders])
  const stats = useMemo(() => saved.enabled?{completed:total(saved.rows,'process',stageCode(stage)).count,events:[]}:summarizeEvents(source, stage, invalid ? '9999' : start, invalid ? '0000' : end), [source, stage, invalid, start, end,saved.enabled,saved.rows])
  const days: string[] = []
  if (!invalid) for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day)
  const countsByDay = new Map<string, { entered: number; completed: number }>()
  for (const event of stats.events) {
    const day = jakartaDate(event.occurredAt)
    const counts = countsByDay.get(day) ?? { entered: 0, completed: 0 }
    if (event.kind === 'entered') counts.entered++
    if (event.kind === 'completed') counts.completed++
    countsByDay.set(day, counts)
  }
  const chart = days.map(day => ({ day, ...(saved.enabled?{entered:0,completed:total(saved.rows,'process',stageCode(stage),day).count}:(countsByDay.get(day) ?? { entered: 0, completed: 0 })) }))
  const output = useMemo(() => saved.enabled?storedOutput(saved.rows):dailyOutput(orders, history, invalid ? '9999' : start, invalid ? '0000' : end), [orders, history, invalid, start, end,saved.enabled,saved.rows])
  const formatMeter = (meter: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(meter)
  const completionCard = { label: isArchive ? 'Selesai' : 'Proses selesai', value: stats.completed, caption: '' }
  const cards = isArchive ? [completionCard] : [
    completionCard,
    { label: 'Output DTF', value: formatMeter(output.dtf.meter) + ' meter', caption: output.dtf.count + ' order selesai print' },
    { label: 'Output Sublim', value: formatMeter(output.sublim.meter) + ' meter', caption: output.sublim.count + ' order selesai print' },
  ]

  function handleStageChange(newStage: ProcessStage) {
    setStage(newStage)
  }

  async function exportCsv() {
    setExporting(true);setExportError('')
    try {
    const events=saved.enabled?(await exportReportDetails(start,end,stageCode(stage))).map(item=>storedEvent(item,stage)):stats.events
    const rows = [['Waktu', 'SPK', 'Pelanggan', 'Proses', 'Aktivitas'], ...events.map(e => [new Date(e.occurredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), e.spkCode, e.customerName, BOARD_STAGE_META[e.stage].name, eventLabel(e.kind)])]
    const csv = rows.map(row => row.map(value => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `laporan-proses-${start}-${end}.csv`
    link.click()
    URL.revokeObjectURL(url)
    }catch(error){setExportError(error instanceof Error?error.message:'Unduhan gagal. Coba kembali.')}finally{setExporting(false)}
  }

  if(saved.enabled&&(saved.loading||saved.error))return <div className="space-y-5"><DateRangeFilter value={range} onChange={onRangeChange}/><ReportStatus report={saved}/></div>
  return (
    <div className="space-y-6 pb-8">
      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Filter laporan">
        <label className="flex min-w-44 flex-col gap-2 text-xs font-semibold text-slate-500">Proses<select className={fieldClass} value={stage} onChange={e => handleStageChange(e.target.value as ProcessStage)}>{BOARD_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}</select></label>
        <DateRangeFilter value={range} onChange={onRangeChange} />
        <button onClick={exportCsv} disabled={invalid || exporting || !stats.completed || saved.loading || !!saved.error} className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40 sm:ml-auto sm:w-auto"><Download className="h-4 w-4" /> Unduh CSV</button>
      </section>
      <ReportStatus report={saved} />
      {exportError&&<p role="alert" className="text-sm text-red-600">{exportError}</p>}
      {invalid && <p role="alert" className="text-sm text-red-600">Pilih tanggal yang valid, tanggal akhir setelah tanggal awal, maksimal 93 hari.</p>}

      <div className={isArchive ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
        {cards.map(card => <section key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{card.label}</p></div><p className="mt-3 text-3xl font-bold text-slate-900">{invalid ? '—' : card.value}</p>{card.caption && <p className="mt-2 text-xs text-slate-400">{card.caption}</p>}</section>)}
      </div>

      {/* Same interactive trend chart as the dashboard output panel. */}
      <section className="rounded-2xl border border-slate-200 bg-white" aria-labelledby="report-trend-title">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h3 id="report-trend-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ChartColumn aria-hidden="true" className="h-4 w-4 text-brand-600" />Order selesai · {BOARD_STAGE_META[stage].name}</h3>
          <span className="text-xs text-slate-500">order per hari</span>
        </header>
        <div className="h-72 p-4">
          {stats.completed ? <TrendChart label={`Grafik ${stats.completed} order selesai. Unduh CSV untuk daftar lengkapnya.`} unit="order" series={[{ label: 'Selesai', color: '#64748b' }]} days={chart.map(day => ({ day: day.day, values: [day.completed] }))} />
            : <EmptyState title="Belum ada aktivitas" text="Grafik tampil setelah ada order yang selesai pada periode ini." />}
        </div>
      </section>

      {!invalid && <ProcessTimingReport stage={stage} start={start} end={end} />}

    </div>
  )
}

export default function ProcessReportsPage() {
  const [range, setRange] = useState(todayRange)

  return (
    <div className="space-y-5">
      <h2 className="page-title">Laporan proses</h2>
      <ProcessReportDetail range={range} onRangeChange={setRange} />
    </div>
  )
}
