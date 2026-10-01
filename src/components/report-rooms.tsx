'use client'

import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Building2, Layers3 } from 'lucide-react'
import DateRangeFilter, { type DateRange } from '@/components/date-range-filter'
import { BOARD_STAGE_META, selectBranch, useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { jakartaDate, PROCESS_STAGES, processReportEvents, summarizeEvents } from '@/lib/process-metrics'
import { useRoomUrl } from '@/lib/room-navigation'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })

export default function ReportRooms({ kind, range, onRangeChange, children }: {
  kind: 'process' | 'archive'
  range: DateRange
  onRangeChange: (range: DateRange) => void
  children: ReactNode
}) {
  const status = useOnlineConnection()
  const orders = useAllOrders()
  const history = useProcessHistory()
  const href = useRoomUrl()
  const allRoom = !!href && new URL(href).searchParams.get('room') === 'all'
  const [opening, setOpening] = useState(false)
  const title = kind === 'process' ? 'Laporan proses' : 'Laporan arsip'
  const branches = status.branches ?? []
  const invalid = !range.start || !range.end || range.start > range.end || !Number.isFinite(Date.parse(range.start)) || !Number.isFinite(Date.parse(range.end)) || (Date.parse(range.end) - Date.parse(range.start)) / 86400000 > 92
  const inRange = (day: string) => !invalid && day >= range.start && day <= range.end
  const detail = !!status.branchId || allRoom || !status.central
  const scope = branches.find(branch => branch.id === status.branchId)?.name ?? (status.central ? 'Semua cabang' : 'Cabang aktif')

  async function openRoom(id: string | null) {
    setOpening(true)
    try {
      await selectBranch(id, { room: id === null ? 'all' : null })
    } catch { /* The connection error is displayed below. */ }
    finally { setOpening(false) }
  }

  async function back() {
    setOpening(true)
    try {
      await selectBranch(null)
    } catch { /* The connection error is displayed below. */ }
    finally { setOpening(false) }
  }

  if (status.state === 'loading' || opening) return <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Memuat ruang laporan...</p>
  if (status.state === 'error') return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{status.error || 'Laporan belum dapat dimuat. Periksa koneksi dan coba lagi.'}</p>

  if (detail) return <div className="space-y-5">
    <header className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
      {status.central && <button type="button" disabled={status.busy} onClick={() => void back()} className="inline-flex items-center justify-self-start gap-2 rounded-xl border border-red-600 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><ArrowLeft className="h-4 w-4" />Semua ruang laporan</button>}
      <div><h2 className="page-title">{title} · {scope}</h2></div>
    </header>
    {children}
  </div>

  const rooms = [{ id: null, name: 'Semua cabang' }, ...branches]
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5"><DateRangeFilter value={range} onChange={onRangeChange} /></div>
    {invalid && <p role="alert" className="text-sm text-red-600">Pilih rentang tanggal yang valid, maksimal 93 hari.</p>}
    <p className="text-sm text-slate-500">{branches.length} ruang cabang dan 1 ruang gabungan</p>
    {rooms.map(room => {
      const roomOrders = room.id === null ? orders : orders.filter(order => order.branch_id === room.id)
      const ids = new Set(roomOrders.map(order => order.id))
      const roomHistory = room.id === null ? history : history.filter(event => event.branchId === room.id || (!event.branchId && ids.has(event.orderId)))
      const events = processReportEvents(roomHistory, roomOrders)
      const archives = roomOrders.filter(order => order.board_stage === 'archive' && order.archive?.finalizedAt && inRange(jakartaDate(order.archive.finalizedAt)))
      const incoming = roomOrders.filter(order => inRange(order.order_date)).length
      const archiveMetrics = [
        { label: 'Order masuk', value: incoming },
        { label: 'Selesai dari arsip', value: archives.length },
        { label: 'Total hasil arsip', value: `${number.format(archives.reduce((sum, order) => sum + order.meter, 0))} m` },
        { label: 'Diambil pembeli', value: archives.filter(order => order.archive?.deliveryMethod === 'pickup').length },
        { label: 'Dikirim', value: archives.filter(order => order.archive?.deliveryMethod === 'delivery').length },
      ]
      return <section key={room.id ?? 'all'} className={`rounded-xl border bg-white p-5 ${room.id === null ? 'border-brand-200' : 'border-slate-200'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-brand-50 p-3 text-brand-600">{room.id === null ? <Layers3 className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}</span><div><h3 className="text-lg font-semibold text-slate-900">{room.name}</h3></div></div>
          <button type="button" disabled={status.busy || invalid} onClick={() => void openRoom(room.id)} aria-label={`Buka ${title.toLowerCase()} ${room.name}`} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Buka laporan <ArrowRight className="h-4 w-4" /></button>
        </div>
        {kind === 'process' ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">{PROCESS_STAGES.map(stage => {
          const stats = summarizeEvents(events, stage, invalid ? '9999' : range.start, invalid ? '0000' : range.end)
          return <div key={stage} data-board-stage={stage} className="board-column overflow-hidden rounded-lg border"><div className="board-column-header h-full p-3"><p className="min-h-8 text-xs font-medium text-slate-700">{BOARD_STAGE_META[stage].name}</p><dl className="mt-3 space-y-2 text-xs text-slate-600">{stage !== 'archive' && <div className="flex justify-between gap-2"><dt>Masuk</dt><dd className="text-base font-semibold tabular-nums text-slate-900">{invalid ? '—' : stats.entered}</dd></div>}<div className="flex justify-between gap-2"><dt>Selesai</dt><dd className="text-base font-semibold tabular-nums text-slate-900">{invalid ? '—' : stats.completed}</dd></div></dl></div></div>
        })}</div> : <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">{archiveMetrics.map(metric => <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-600">{metric.label}</dt><dd className="mt-3 text-xl font-semibold tabular-nums text-slate-900">{invalid ? '—' : metric.value}</dd></div>)}</dl>}
      </section>
    })}
  </div>
}
