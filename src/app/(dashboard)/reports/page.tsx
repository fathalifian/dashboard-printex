'use client'

import { useState } from 'react'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import { ProcessTimingReport } from '@/components/production-timers'
import { Download } from 'lucide-react'
import { BOARD_STAGE_META, useAllOrders, useProcessHistory } from '@/lib/production-board'
import { jakartaDate, PROCESS_STAGES, summarizeEvents, processReportEvents, type ProcessStage } from '@/lib/process-metrics'

function shiftDay(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+07:00`)
  value.setUTCDate(value.getUTCDate() + amount)
  return jakartaDate(value)
}
const fieldClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700'
const eventLabel = (kind: string) => kind === 'completed' ? 'Selesai' : 'Masuk'

export default function ProcessReportsPage() {
  const orders = useAllOrders()
  const history = useProcessHistory()
  const [stage, setStage] = useState<ProcessStage>('incoming')
  const [range,setRange] = useState(todayRange)
  const {start,end} = range
  const isArchive = stage === 'archive'
  const invalid = !start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92
  const source = processReportEvents(history, orders)
  const stats = summarizeEvents(source, stage, invalid ? '9999' : start, invalid ? '0000' : end)
  const days: string[] = []
  if (!invalid) for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day)
  const chart = days.map(day => ({ day, ...summarizeEvents(source, stage, day, day) }))
  const max = Math.max(4, ...chart.flatMap(day => [day.entered, day.completed]))
  const current = orders.filter(order => order.board_stage === stage).length
  const completionCard = { label: isArchive ? 'Selesai' : 'Proses selesai', value: stats.completed, caption: isArchive ? 'Berdasarkan tanggal klik Selesai di board Arsip' : 'Berpindah ke tahap lebih lanjut' }
  const cards = isArchive ? [completionCard] : [
    { label: 'Masuk ke proses', value: stats.entered, caption: 'Order unik masuk pertama kali' },
    completionCard,
    { label: 'Order di tahap ini', value: current, caption: 'Posisi saat ini' },
  ]

  function exportCsv() {
    const rows = [['Waktu', 'SPK', 'Pelanggan', 'Proses', 'Aktivitas'], ...stats.events.map(e => [new Date(e.occurredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), e.spkCode, e.customerName, BOARD_STAGE_META[e.stage].name, eventLabel(e.kind)])]
    const csv = rows.map(row => row.map(value => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `laporan-proses-${start}-${end}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-8">
      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Filter laporan">
        <label className="flex min-w-44 flex-col gap-2 text-xs font-semibold text-slate-500">Proses<select className={fieldClass} value={stage} onChange={e => setStage(e.target.value as ProcessStage)}>{PROCESS_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}</select></label>
        <DateRangeFilter value={range} onChange={setRange} />
        <button onClick={exportCsv} disabled={invalid || !stats.events.length} className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40 sm:ml-auto sm:w-auto"><Download className="h-4 w-4" /> Unduh CSV</button>
      </section>
      {invalid && <p role="alert" className="text-sm text-red-600">Pilih tanggal yang valid, tanggal akhir setelah tanggal awal, maksimal 93 hari.</p>}

      <div className={isArchive ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
        {cards.map(card => <section key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{card.label}</p></div><p className="mt-3 text-3xl font-bold text-slate-900">{invalid && card.label !== 'Order di tahap ini' ? '—' : card.value}</p><p className="mt-2 text-xs text-slate-400">{card.caption}</p></section>)}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{isArchive ? 'Selesai' : 'Masuk vs selesai'}</h3><p className="mt-1 text-xs text-slate-500">{BOARD_STAGE_META[stage].name} · {start} — {end}</p></div><div className="flex gap-4 text-xs text-slate-600">{!isArchive && <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-brand-500" />Masuk</span>}<span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Selesai</span></div></div>
        <div className="mt-6 overflow-x-auto" role="img" aria-label={isArchive ? `Grafik ${stats.completed} order selesai dari Arsip. Rincian tersedia pada tabel di bawah.` : `Grafik ${stats.entered} masuk dan ${stats.completed} selesai. Rincian tersedia pada tabel di bawah.`}>
          <div className="flex h-60 items-end gap-3 border-b border-slate-200" style={{ minWidth: Math.max(300, days.length * 62) }}>
            {chart.map(day => <div key={day.day} className="flex h-full flex-1 flex-col justify-end"><div className="flex h-48 items-end justify-center gap-1.5 border-b border-slate-100">{[...(!isArchive ? [{ value: day.entered, color: 'bg-brand-500', label: 'masuk' }] : []), { value: day.completed, color: 'bg-slate-400', label: 'selesai' }].map(bar => <div key={bar.label} className="flex h-full w-6 flex-col justify-end text-center"><span className="mb-1 text-[10px] font-semibold text-slate-500">{bar.value}</span><div title={`${day.day}: ${bar.value} ${bar.label}`} className={`w-full rounded-t-md ${bar.color}`} style={{ height: `${Math.max(1, bar.value / max * 85)}%`, opacity: bar.value ? 1 : 0.15 }} /></div>)}</div><p className="py-3 text-center text-[11px] text-slate-500">{day.day.slice(8)} / {day.day.slice(5, 7)}</p></div>)}
          </div>
        </div>
        {!stats.events.length && <p className="mt-4 text-center text-sm text-slate-400">Belum ada aktivitas pada periode ini.</p>}
      </section>

      {!invalid && <ProcessTimingReport stage={stage} start={start} end={end} />}


    </div>
  )
}
