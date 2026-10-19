'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Tabs } from './fit'
import { STATIONS } from './capacity'
import { pct } from './efficiency-views'
import { duration } from './flow-strip'
import type { ProductionMetrics } from './use-production-metrics'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const NAME = { design: 'Desain', sublim: 'Sublim', press: 'Press', dtf: 'DTF' } as const
type View = 'capacity' | 'productivity' | 'efficiency' | 'bottleneck'
const VIEWS = [{ id: 'capacity', label: 'Kapasitas' }, { id: 'productivity', label: 'Produktivitas' }, { id: 'efficiency', label: 'Efisiensi' }, { id: 'bottleneck', label: 'Bottleneck' }] as const
const n = (value: number | null) => value === null ? 'belum dicatat' : number.format(value)
const p = (value: number | null) => value === null ? 'belum dicatat' : pct(value)

/** A step-by-step table: inputs filled in and the result in the last column. */
function Steps({ title, head, rows, note }: { title: string; head: string[]; rows: ReactNode[][]; note?: ReactNode }) {
  return <section aria-label={title} className="space-y-1.5">
    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-slate-50 text-slate-500"><tr>{head.map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${index ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0
          ? <th key={column} scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-800">{cell}</th>
          : <td key={column} className={`whitespace-nowrap px-3 py-2 text-right ${column === row.length - 1 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{cell}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="px-3 py-4 text-center text-slate-500">Belum ada data pada periode ini.</td></tr>}
        </tbody>
      </table>
    </div>
    {note && <p className="text-xs text-slate-500">{note}</p>}
  </section>
}

function CapacitySteps({ metrics }: { metrics: ProductionMetrics }) {
  const { result } = metrics.capacity
  const T = result.effectiveHours, A = result.availableHours
  const rows = STATIONS.map(({ process, name }) => {
    const item = result.processes[process]
    return [name, `${item.machines} mesin`, `${n(item.productivity)} m/jam`, `${n(item.designCapacity)} m`, `${n(item.capacity)} m`]
  })
  rows.push(['Lini Sublim → Press', '', 'nilai terendah', `${n(result.system.designCapacity)} m`, `${n(result.system.capacity)} m`])
  return <Steps title="Kapasitas per hari" head={['Stasiun', 'Mesin', 'Produktivitas (P)', `Desain (P × ${number.format(A)} jam)`, `Efektif (P × ${number.format(T)} jam)`]} rows={rows}
    note="P = meter ÷ jam mesin dari Mulai–Selesai (bila belum dicatat: lama order di tahap). Press DTF punya lini sendiri dan tidak dihitung. Jam tersedia = shift × jam per shift; jam efektif = jam tersedia − istirahat & setup. Kapasitas stasiun = jumlah kapasitas mesinnya." />
}

function ProductivitySteps({ metrics }: { metrics: ProductionMetrics }) {
  const { labor, previousLabor, growth, design } = metrics
  const rows: ReactNode[][] = labor ? [
    ['Produktivitas mesin', `${number.format(labor.output)} m ÷ ${number.format(labor.stations.sublim.runHours + labor.stations.dtf.runHours)} jam mesin`, `${n(labor.perMachineHour)} m/jam-mesin`],
    ['Produktivitas tenaga kerja', `${number.format(labor.output)} m ÷ ${number.format(labor.manHours)} jam-orang`, `${n(labor.perManHour)} m/jam-orang`],
    ['Order per operator per hari', `${labor.orders} order ÷ ${labor.peopleDays} hari-operator`, n(labor.ordersPerOperatorDay)],
    ['Produktivitas desain', `${design.orders} order ÷ ${number.format(design.manHours)} jam-orang`, `${n(design.perManHour)} order/jam`],
    ['Pertumbuhan tenaga kerja', `${n(labor.perManHour)} vs ${n(previousLabor?.perManHour ?? null)}`, p(growth.perManHour)],
    ['Pertumbuhan mesin', `${n(labor.perMachineHour)} vs ${n(previousLabor?.perMachineHour ?? null)}`, p(growth.perMachineHour)],
  ] : []
  return <Steps title="Produktivitas" head={['Indikator', 'Perhitungan', 'Hasil']} rows={rows}
    note="Output cetak = meter yang selesai dicetak; output desain = jumlah order yang selesai desain. Jam-orang = operator standar × jam efektif per hari kerja, kecuali hari yang diubah di Jam operator." />
}

function EfficiencySteps({ metrics }: { metrics: ProductionMetrics }) {
  const { result } = metrics.capacity
  const rows = STATIONS.map(({ process, name }) => {
    const item = result.processes[process]
    return [name, `${number.format(Math.round(item.dailyOutput))} m`, `${n(item.capacity === null ? null : Math.round(item.capacity))} m`, p(item.efficiency)]
  })
  rows.push(['Lini Sublim → Press', `${number.format(Math.round(result.system.dailyOutput))} m`, `${n(result.system.capacity === null ? null : Math.round(result.system.capacity))} m`, p(result.system.efficiency)])
  return <Steps title="Efisiensi = output aktual ÷ kapasitas efektif" head={['Stasiun', 'Output aktual / hari', 'Kapasitas efektif / hari', 'Efisiensi']} rows={rows}
    note="Status: Rendah < 70%, Cukup 70–80%, Ideal 80–85%, Padat 85–90%, Penuh ≥ 90%." />
}

function BottleneckSteps({ metrics }: { metrics: ProductionMetrics }) {
  const { loads, bottleneckRow, bottleneckSpeed, waits } = metrics
  return <div className="space-y-4">
    <Steps title="Beban = kebutuhan ÷ kapasitas efektif periode" head={['Stasiun', 'Kebutuhan', 'Kapasitas', 'Beban', 'Antre (WIP)']}
      rows={loads.rows.map(row => [`${NAME[row.id]}${bottleneckRow?.id === row.id ? ' · Bottleneck' : ''}`, `${number.format(row.demand)} ${row.unit}`, row.capacity === null ? 'belum dicatat' : `${number.format(row.capacity)} ${row.unit}`,
        `${p(row.load)}${row.critical ? ' · kritis' : ''}`, `${row.wip} order`])}
      note="Kebutuhan = meter order masuk pada periode + antrean lama yang belum melewati stasiun. Order DTF hanya membebani DTF. Beban di atas 100% = kritis. Menunggu Pembayaran bukan stasiun produksi." />
    <Steps title="Indikator pendukung" head={['Indikator', 'Hasil']}
      rows={[
        ['Waktu tunggu administrasi (Menunggu Pembayaran)', waits.admin === null ? 'belum ada data' : duration(waits.admin) ?? '0'],
        ['Rata-rata tunggu di Proses Sublim', waits.printing === null ? 'tidak ada antrean' : duration(waits.printing) ?? '0'],
        ['Rata-rata tunggu di Proses Press', waits.press === null ? 'tidak ada antrean' : duration(waits.press) ?? '0'],
        ['Output hilang per jam bila bottleneck berhenti', bottleneckSpeed === null ? 'belum dicatat' : `${number.format(bottleneckSpeed)} m/jam`],
      ]} />
  </div>
}

/** Formulas, inputs and results for every tab of the production panel. */
export default function MetricDetails({ metrics, initialView, onClose }: { metrics: ProductionMetrics; initialView: View; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<View>(initialView)
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { dialog.current?.close(); onClose() }
  return <dialog ref={dialog} aria-labelledby="metric-details-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-950/50">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="metric-details-title" className="text-base font-semibold text-slate-900">Rincian perhitungan</h2>
      <div className="flex items-center gap-2">
        <Tabs label="Bagian rincian" value={view} onChange={setView} items={VIEWS} />
        <button type="button" onClick={close} aria-label="Tutup rincian" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"><X size={18} /></button>
      </div>
    </header>
    {view === 'capacity' ? <CapacitySteps metrics={metrics} /> : view === 'productivity' ? <ProductivitySteps metrics={metrics} /> : view === 'efficiency' ? <EfficiencySteps metrics={metrics} /> : <BottleneckSteps metrics={metrics} />}
  </dialog>
}
