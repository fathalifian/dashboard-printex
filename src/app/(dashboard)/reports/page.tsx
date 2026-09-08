'use client'

import { useState } from 'react'
import { ProcessTimingReport } from '@/components/production-timers'
import { ArrowDownToLine, ArrowUpRight, ChartColumn, CheckCheck, Download } from 'lucide-react'
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
  const [period, setPeriod] = useState('today')
  const [anchor, setAnchor] = useState(() => jakartaDate(new Date()))
  const [customStart, setCustomStart] = useState(anchor)
  const [customEnd, setCustomEnd] = useState(anchor)
  const isArchive = stage === 'archive'
  const start = period === 'custom' ? customStart : period === 'today' ? anchor : shiftDay(anchor, -6)
  const end = period === 'custom' ? customEnd : anchor
  const invalid = !start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92
  const source = processReportEvents(history, orders)
  const stats = summarizeEvents(source, stage, invalid ? '9999' : start, invalid ? '0000' : end)
  const days: string[] = []
  if (!invalid) for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day)
  const chart = days.map(day => ({ day, ...summarizeEvents(source, stage, day, day) }))
  const max = Math.max(4, ...chart.flatMap(day => [day.entered, day.completed]))
  const current = orders.filter(order => order.board_stage === stage).length
  const completionCard = { label: isArchive ? 'Selesai' : 'Proses selesai', value: stats.completed, icon: CheckCheck, color: 'text-emerald-600 bg-emerald-50', caption: isArchive ? 'Berdasarkan tanggal klik Selesai di board Arsip' : 'Berpindah ke tahap lebih lanjut' }
  const cards = isArchive ? [completionCard] : [
    { label: 'Masuk ke proses', value: stats.entered, icon: ArrowDownToLine, color: 'text-blue-600 bg-blue-50', caption: 'Order unik masuk pertama kali' },
    completionCard,
    { label: 'Order di tahap ini', value: current, icon: ArrowUpRight, color: 'text-violet-600 bg-violet-50', caption: 'Posisi saat ini' },
  ]

  function exportCsv() {
    const rows = [['Waktu (WIB)', 'SPK', 'Pelanggan', 'Proses', 'Aktivitas'], ...stats.events.map(e => [new Date(e.occurredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), e.spkCode, e.customerName, BOARD_STAGE_META[e.stage].name, eventLabel(e.kind)])]
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-blue-600"><ChartColumn className="h-4 w-4" /> Produktivitas tim</div><h2 className="text-2xl font-bold text-slate-900">Laporan Proses</h2><p className="mt-1 text-sm text-slate-500">Pantau pekerjaan masuk dan penyelesaian di setiap tahap produksi.</p></div>
        <button onClick={exportCsv} disabled={invalid || !stats.events.length} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"><Download className="h-4 w-4" /> Unduh CSV</button>
      </div>

      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Filter laporan">
        <label className="flex min-w-44 flex-col gap-2 text-xs font-semibold text-slate-500">Proses<select className={fieldClass} value={stage} onChange={e => setStage(e.target.value as ProcessStage)}>{PROCESS_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}</select></label>
        <label className="flex flex-col gap-2 text-xs font-semibold text-slate-500">Periode<select className={fieldClass} value={period} onChange={e => { setPeriod(e.target.value); setAnchor(jakartaDate(new Date())) }}><option value="today">Hari ini</option><option value="week">7 hari terakhir</option><option value="custom">Rentang tanggal</option></select></label>
        {period === 'custom' && <><label className="flex flex-col gap-2 text-xs font-semibold text-slate-500">Dari<input type="date" className={fieldClass} value={customStart} onChange={e => setCustomStart(e.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold text-slate-500">Sampai<input type="date" className={fieldClass} value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label></>}
        <span className="pb-3 text-xs text-slate-400">Zona waktu: WIB</span>
      </section>
      {invalid && <p role="alert" className="text-sm text-red-600">Pilih tanggal yang valid, tanggal akhir setelah tanggal awal, maksimal 93 hari.</p>}

      <div className={isArchive ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
        {cards.map(card => <section key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{card.label}</p><span className={`rounded-xl p-2 ${card.color}`}><card.icon className="h-5 w-5" /></span></div><p className="mt-3 text-3xl font-bold text-slate-900">{invalid && card.label !== 'Order di tahap ini' ? '—' : card.value}</p><p className="mt-2 text-xs text-slate-400">{card.caption}</p></section>)}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{isArchive ? 'Selesai' : 'Masuk vs selesai'}</h3><p className="mt-1 text-xs text-slate-500">{BOARD_STAGE_META[stage].name} · {start} — {end}</p></div><div className="flex gap-4 text-xs text-slate-600">{!isArchive && <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500" />Masuk</span>}<span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Selesai</span></div></div>
        <div className="mt-6 overflow-x-auto" role="img" aria-label={isArchive ? `Grafik ${stats.completed} order selesai dari Arsip. Rincian tersedia pada tabel di bawah.` : `Grafik ${stats.entered} masuk dan ${stats.completed} selesai. Rincian tersedia pada tabel di bawah.`}>
          <div className="flex h-60 items-end gap-3 border-b border-slate-200" style={{ minWidth: Math.max(300, days.length * 62) }}>
            {chart.map(day => <div key={day.day} className="flex h-full flex-1 flex-col justify-end"><div className="flex h-48 items-end justify-center gap-1.5 border-b border-slate-100">{[...(!isArchive ? [{ value: day.entered, color: 'bg-blue-500', label: 'masuk' }] : []), { value: day.completed, color: 'bg-emerald-500', label: 'selesai' }].map(bar => <div key={bar.label} className="flex h-full w-6 flex-col justify-end text-center"><span className="mb-1 text-[10px] font-semibold text-slate-500">{bar.value}</span><div title={`${day.day}: ${bar.value} ${bar.label}`} className={`w-full rounded-t-md ${bar.color}`} style={{ height: `${Math.max(1, bar.value / max * 85)}%`, opacity: bar.value ? 1 : 0.15 }} /></div>)}</div><p className="py-3 text-center text-[11px] text-slate-500">{day.day.slice(8)} / {day.day.slice(5, 7)}</p></div>)}
          </div>
        </div>
        {!stats.events.length && <p className="mt-4 text-center text-sm text-slate-400">Belum ada aktivitas tercatat pada periode ini. Perubahan tahap di Board Produksi akan muncul di sini.</p>}
      </section>

      {!invalid && <ProcessTimingReport stage={stage} start={start} end={end} />}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h3 className="font-bold text-slate-900">Ringkasan proses</h3><p className="mt-1 text-xs text-slate-500">Mengikuti proses dan periode yang dipilih.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{(isArchive ? ['Proses', 'Selesai'] : ['Proses', 'Masuk', 'Selesai']).map(title => <th key={title} className="px-5 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{PROCESS_STAGES.filter(id => stage === id).map(id => { const count = summarizeEvents(source, id, invalid ? '9999' : start, invalid ? '0000' : end); return <tr key={id} className="border-t border-slate-100 text-slate-700"><td className="px-5 py-4 font-medium">{BOARD_STAGE_META[id].name}</td>{!isArchive && <td className="px-5 py-4 text-blue-600">{count.entered}</td>}<td className="px-5 py-4 font-semibold text-emerald-600">{count.completed}</td></tr> })}</tbody></table></div></section>


      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-6 text-blue-700"><p className="font-semibold">Pencatatan online</p><p>Riwayat tersimpan di database dan diperbarui antarperangkat. Perubahan proses dicatat otomatis oleh database.</p><p>Setiap order memiliki satu ID tetap. Masuk dan selesai masing-masing dihitung satu kali per proses, pada tanggal pertama tercatat. Perpindahan berulang tidak menambah hitungan, termasuk pada hari berikutnya. Selesai berarti keluar ke tahap lebih lanjut. Khusus Arsip, selesai dihitung pada tanggal tombol Selesai ditekan, bukan tanggal masuk Arsip. Angka selesai bisa lebih besar dari masuk karena pekerjaan berasal dari hari sebelumnya.</p></div>
    </div>
  )
}
