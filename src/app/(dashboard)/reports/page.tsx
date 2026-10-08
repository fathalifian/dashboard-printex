'use client'

import { useMemo, useState } from 'react'
import ReportStatus from '@/components/report-status'
import { useDailySummary, useReportDetails, total, storedOutput, stageCode, storedEvent, exportReportDetails } from '@/lib/report-summaries'
import ReportRooms from '@/components/report-rooms'
import Link from 'next/link'
import DateRangeFilter, { todayRange, type DateRange } from '@/components/date-range-filter'
import { ProcessTimingReport } from '@/components/production-timers'
import { dailyOutput } from '@/lib/daily-output'
import { Download } from 'lucide-react'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory, useOnlineConnection } from '@/lib/production-board'
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
  const connection = useOnlineConnection()
  const branchMap = useMemo(() => new Map((connection.branches ?? []).map(b => [b.id, b.name])), [connection.branches])
  const orderMap = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])
  const branchName = (branchId?: string) => (branchId ? branchMap.get(branchId) : undefined) ?? 'Belum tercatat'
  const eventBranch = (event: typeof history[number]) => branchName(event.branchId ?? orderMap.get(event.orderId)?.branch_id)
  const [stage, setStage] = useState<ProcessStage>('incoming')
  const [page, setPage] = useState(1)
  const pageSize = 50

  const { start, end } = range
  const isArchive = stage === 'archive'
  const invalid = !start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92
  const saved=useDailySummary(start,end)
  const details=useReportDetails(start,end,'process',stageCode(stage),page,'',saved.enabled&&!invalid&&!saved.loading&&!saved.error)
  const [exporting,setExporting]=useState(false)
  const [exportError,setExportError]=useState('')
  const source = useMemo(() => completionReportEvents(history, orders), [history, orders])
  const stats = useMemo(() => saved.enabled?{completed:total(saved.rows,'process',stageCode(stage)).count,events:details.items.map(item=>storedEvent(item,stage))}:summarizeEvents(source, stage, invalid ? '9999' : start, invalid ? '0000' : end), [source, stage, invalid, start, end,saved.enabled,saved.rows,details.items])
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
  const chart = days.map(day => ({ day, ...(saved.enabled?{entered:0,completed:total(saved.rows,'process',stageCode(stage),null,day).count}:(countsByDay.get(day) ?? { entered: 0, completed: 0 })) }))
  const max = Math.max(4, ...chart.flatMap(day => [day.completed]))
  const output = useMemo(() => saved.enabled?storedOutput(saved.rows):dailyOutput(orders, history, invalid ? '9999' : start, invalid ? '0000' : end), [orders, history, invalid, start, end,saved.enabled,saved.rows])
  const formatMeter = (meter: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(meter)
  const completionCard = { label: isArchive ? 'Selesai' : 'Proses selesai', value: stats.completed, caption: '' }
  const cards = isArchive ? [completionCard] : [
    completionCard,
    { label: 'Output DTF', value: formatMeter(output.dtf.meter) + ' meter', caption: output.dtf.count + ' order selesai print' },
    { label: 'Output Sublim', value: formatMeter(output.sublim.meter) + ' meter', caption: output.sublim.count + ' order selesai print' },
  ]

  const allReversedEvents = useMemo(() => [...stats.events].reverse(), [stats.events])
  const eventCount=saved.enabled?details.total:allReversedEvents.length
  const totalPages = Math.max(1, Math.ceil(eventCount / pageSize))
  const currentPage = saved.enabled?page:Math.min(page, totalPages)
  const pagedEvents = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize
    return saved.enabled?stats.events:allReversedEvents.slice(startIdx, startIdx + pageSize)
  }, [allReversedEvents, currentPage, pageSize,saved.enabled,stats.events])

  function handleStageChange(newStage: ProcessStage) {
    setStage(newStage)
    setPage(1)
  }

  function handleRangeChange(newRange: DateRange) {
    onRangeChange(newRange)
    setPage(1)
  }

  async function exportCsv() {
    setExporting(true);setExportError('')
    try {
    const events=saved.enabled?(await exportReportDetails(start,end,stageCode(stage),connection.branchId??null)).map(item=>storedEvent(item,stage)):stats.events
    const rows = [['Waktu', 'Cabang', 'SPK', 'Pelanggan', 'Proses', 'Aktivitas'], ...events.map(e => [new Date(e.occurredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), eventBranch(e), e.spkCode, e.customerName, BOARD_STAGE_META[e.stage].name, eventLabel(e.kind)])]
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
    <div className="mx-auto max-w-[1500px] space-y-6 pb-8">
      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Filter laporan">
        <label className="flex min-w-44 flex-col gap-2 text-xs font-semibold text-slate-500">Proses<select className={fieldClass} value={stage} onChange={e => handleStageChange(e.target.value as ProcessStage)}>{BOARD_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}</select></label>
        <DateRangeFilter value={range} onChange={handleRangeChange} />
        <button onClick={exportCsv} disabled={invalid || exporting || !stats.completed || saved.loading || !!saved.error} className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40 sm:ml-auto sm:w-auto"><Download className="h-4 w-4" /> Unduh CSV</button>
      </section>
      <ReportStatus report={saved} />
      {exportError&&<p role="alert" className="text-sm text-red-600">{exportError}</p>}
      {invalid && <p role="alert" className="text-sm text-red-600">Pilih tanggal yang valid, tanggal akhir setelah tanggal awal, maksimal 93 hari.</p>}

      <div className={isArchive ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
        {cards.map(card => <section key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{card.label}</p></div><p className="mt-3 text-3xl font-bold text-slate-900">{invalid ? '—' : card.value}</p>{card.caption && <p className="mt-2 text-xs text-slate-400">{card.caption}</p>}</section>)}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Selesai</h3><p className="mt-1 text-xs text-slate-500">{BOARD_STAGE_META[stage].name} · {start} — {end}</p></div><div className="flex gap-4 text-xs text-slate-600"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Selesai</span></div></div>
        <div className="mt-6 overflow-x-auto" role="img" aria-label={`Grafik ${stats.completed} order selesai. Rincian tersedia pada tabel di bawah.`}>
          <div className="flex h-60 items-end gap-3 border-b border-slate-200" style={{ minWidth: Math.max(300, days.length * 62) }}>
            {chart.map(day => <div key={day.day} className="flex h-full flex-1 flex-col justify-end"><div className="flex h-48 items-end justify-center gap-1.5 border-b border-slate-100">{[{ value: day.completed, color: 'bg-slate-400', label: 'selesai' }].map(bar => <div key={bar.label} className="flex h-full w-6 flex-col justify-end text-center"><span className="mb-1 text-[10px] font-semibold text-slate-500">{bar.value}</span><div title={`${day.day}: ${bar.value} ${bar.label}`} className={`w-full rounded-t-md ${bar.color}`} style={{ height: `${Math.max(1, bar.value / max * 85)}%`, opacity: bar.value ? 1 : 0.15 }} /></div>)}</div><p className="py-3 text-center text-[11px] text-slate-500">{day.day.slice(8)} / {day.day.slice(5, 7)}</p></div>)}
          </div>
        </div>
        {!stats.completed && <p className="mt-4 text-center text-sm text-slate-400">Belum ada aktivitas pada periode ini.</p>}
      </section>

      {!invalid && <ProcessTimingReport stage={stage} start={start} end={end} />}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5"><h3 className="font-semibold text-slate-900">Rincian aktivitas</h3><p className="mt-1 text-sm text-slate-500">{eventCount} aktivitas</p></div>
        <ReportStatus report={details} />
        <div className="max-h-[560px] overflow-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{['Waktu (WIB)', 'Cabang', 'SPK', 'Pelanggan', 'Aktivitas'].map(label => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{pagedEvents.map(event => <tr key={event.id} className="border-t border-slate-100 text-slate-600"><td className="px-5 py-3">{new Date(event.occurredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td><td className="px-5 py-3">{eventBranch(event)}</td><td className="px-5 py-3 font-medium text-slate-900">{(orderMap.has(event.orderId)||(saved.enabled&&event.orderExists!==false)) ? <Link href={`/orders/${event.orderId}?from=reports`} className="text-brand-600 hover:underline">{event.spkCode}</Link> : event.spkCode}</td><td className="px-5 py-3">{event.customerName}</td><td className="px-5 py-3">{eventLabel(event.kind)}</td></tr>)}{!stats.completed && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">Belum ada aktivitas pada periode ini.</td></tr>}</tbody></table></div>
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Menampilkan {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, eventCount)} dari {eventCount} aktivitas</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Sebelumnya</button>
              <span className="font-medium text-slate-600">Hal {currentPage} dari {totalPages}</span>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Berikutnya</button>
            </div>
          </div>
        )}
      </section>

    </div>
  )
}

export default function ProcessReportsPage() {
  const [range, setRange] = useState(todayRange)

  return (
    <ReportRooms kind="process" range={range} onRangeChange={setRange}>
      <ProcessReportDetail range={range} onRangeChange={setRange} />
    </ReportRooms>
  )
}
