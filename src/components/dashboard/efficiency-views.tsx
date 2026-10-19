'use client'

import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react'
import { roundTo } from '@/lib/production-efficiency'
import { EmptyState, Tip } from './fit'
import { noCapacity, ProductivityBars, StationRings, StatusPill } from './capacity'
import { duration } from './flow-strip'
import type { ProductionMetrics } from './use-production-metrics'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 })
const one = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const pct = (value: number) => `${one.format(roundTo(value * 100))}%`
const NAME = { design: 'Desain', sublim: 'Sublim', press: 'Press', dtf: 'DTF' } as const

export const HINTS = {
  runs: 'Tekan "Mulai cetak" dan "Selesai cetak" pada kartu di Board Produksi.',
  shifts: 'Atur operator standar di Pusat Admin → Waktu kerja.',
  migration: 'Jalankan supabase/SETUP.sql di Supabase.',
}

/** Shown instead of a number when the data has not been recorded yet (never "—" or 0). */
export function Missing({ hint, className = '' }: { hint: string; className?: string }) {
  return <span tabIndex={0} className={`group relative inline-flex cursor-help items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-500 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}>
    Belum dicatat<Info aria-hidden="true" className="h-3 w-3" /><Tip side="top">{hint}</Tip>
  </span>
}

export function Growth({ value }: { value: number | null }) {
  if (value === null) return null
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold ${up ? 'text-emerald-700' : 'text-red-600'}`} title="Dibanding periode sebelumnya">
    <Icon aria-hidden="true" className="h-3.5 w-3.5" />{up ? '+' : ''}{one.format(roundTo(value * 100))}%
  </span>
}

function Stat({ label, value, unit, missing, footer }: { label: string; value: number | null; unit: string; missing: string; footer?: ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 px-3 py-2">
    <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    {value === null ? <div className="mt-1"><Missing hint={missing} /></div>
      : <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1"><strong className="text-xl font-semibold tabular-nums text-slate-900">{number.format(value)}</strong><span className="text-xs text-slate-500">{unit}</span>{footer}</p>}
  </div>
}

/** Machine productivity from runs, labour productivity from man-hours, both with growth; per station. */
export function ProductivityView({ metrics }: { metrics: ProductionMetrics }) {
  if (!metrics.recorded) return metrics.recordsLoaded ? <EmptyState title="Belum tersedia" text={HINTS.migration} /> : <p role="status" className="p-4 text-sm text-slate-500">Memuat...</p>
  const { labor, growth, capacity, design } = metrics
  const stations = labor ? (['sublim', 'press', 'dtf'] as const).map(id => ({ id, ...labor.stations[id] })).filter(row => row.runHours > 0) : []
  const peak = Math.max(1, ...stations.map(row => row.perMachineHour ?? 0))
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <Stat label="Per mesin" value={labor?.perMachineHour ?? null} unit="m/jam" missing={HINTS.runs} footer={labor?.perMachineHour !== null && <Growth value={growth.perMachineHour} />} />
      <Stat label="Per orang" value={labor?.perManHour ?? null} unit="m/jam" missing={labor?.manHours ? HINTS.runs : HINTS.shifts} footer={labor?.perManHour !== null && <Growth value={growth.perManHour} />} />
      <Stat label="Order/operator" value={labor?.ordersPerOperatorDay ?? null} unit="per hari" missing={labor?.peopleDays ? HINTS.runs : HINTS.shifts} />
      <Stat label="Desain" value={design.perManHour} unit="order/jam" missing={design.manHours ? 'Belum ada desain selesai pada periode ini.' : HINTS.shifts} />
    </div>
    {stations.length ? <ul className="min-h-0 flex-1 space-y-2 overflow-hidden" aria-label="Produktivitas per stasiun (jam mesin berjalan)">
      {stations.map(row => <li key={row.id} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
        <span className="font-medium text-slate-700">{NAME[row.id]}</span>
        <span className="h-2 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-slate-500" style={{ width: `${(row.perMachineHour ?? 0) / peak * 100}%` }} /></span>
        <span className="whitespace-nowrap tabular-nums text-slate-600" title={`${number.format(row.runHours)} jam mesin berjalan`}><strong className="text-slate-900">{number.format(row.perMachineHour ?? 0)}</strong> m/jam</span>
      </li>)}
    </ul> : <div className="min-h-0 flex-1 overflow-hidden">
      <p className="mb-1.5 text-[11px] text-slate-500" title={HINTS.runs}>Perkiraan · belum ada catatan cetak</p>
      <ProductivityBars capacity={capacity} />
    </div>}
  </div>
}

/** Efisiensi = output aktual ÷ kapasitas efektif, for the line and each station. */
export function EfficiencyView({ metrics }: { metrics: ProductionMetrics }) {
  const { capacity } = metrics
  const { system } = capacity.result
  if (noCapacity(capacity)) return <EmptyState title="Belum ada data" text="Belum ada order selesai pada periode ini." />
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" title="Output aktual ÷ kapasitas efektif">Efisiensi lini</p>
        <p className="mt-1 flex items-baseline gap-1.5"><strong className="text-[clamp(1.5rem,4.5vh,2.25rem)] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{system.efficiency === null ? '0%' : pct(system.efficiency)}</strong></p>
      </div>
      <div className="space-y-0.5 text-right text-xs">
        {system.efficiency !== null && <StatusPill value={system.efficiency} />}
        <p className="whitespace-nowrap tabular-nums text-slate-500">{number.format(Math.round(system.dailyOutput))} / {system.capacity === null ? 0 : number.format(Math.round(system.capacity))} m/hari</p>
      </div>
    </div>
    <StationRings capacity={capacity} measure="efficiency" />
  </div>
}

/** Load per station against a 100% line; the bottleneck is red with a text label. */
export function BottleneckView({ metrics }: { metrics: ProductionMetrics }) {
  const { loads, bottleneckRow, bottleneckSpeed, waits, designAvailable, includeDesign, setIncludeDesign } = metrics
  const scale = Math.max(1.2, ...loads.rows.map(row => row.load ?? 0))
  if (loads.rows.every(row => row.load === null)) return <EmptyState title="Belum ada data" text="Belum ada order selesai pada periode ini." />
  return <div className="flex h-full min-h-0 flex-col gap-2">
    <ul className="min-h-0 flex-1 space-y-2" aria-label="Beban per stasiun">
      {loads.rows.map(row => {
        const top = bottleneckRow?.id === row.id
        return <li key={row.id} tabIndex={0} className="group relative grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className={`truncate text-xs ${top ? 'font-semibold text-red-700' : 'font-medium text-slate-700'}`}>{NAME[row.id]}</span>
          <span className="relative h-3 rounded-full bg-slate-100">
            {row.load !== null && <span className={`absolute inset-y-0 left-0 rounded-full ${top || row.critical ? 'bg-red-500' : row.load >= 0.85 ? 'bg-amber-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(100, row.load / scale * 100)}%` }} />}
            <span aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-slate-700" style={{ left: `${100 / scale}%` }} title="100%" />
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            {row.load === null ? <Missing hint={row.id === 'design' ? 'Isi kecepatan desain (order/jam) di Pusat Admin → Waktu kerja.' : 'Belum ada data proses stasiun ini pada periode terpilih.'} /> : <strong className="tabular-nums text-slate-900">{pct(row.load)}</strong>}
            {top && <span className="rounded bg-red-600 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">{row.critical ? 'Kritis' : 'Bottleneck'}</span>}
            {!top && row.critical && <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-semibold leading-none text-red-700">Kritis</span>}
          </span>
          <Tip side="top">
            <span className="block font-semibold text-slate-900">{NAME[row.id]}</span>
            <span className="block">Kebutuhan {number.format(row.demand)} {row.unit} ÷ kapasitas {row.capacity === null ? '0' : number.format(row.capacity)} {row.unit}</span>
            <span className="block">Antre (WIP): {row.wip} order{row.id === 'sublim' || row.id === 'dtf' ? ` · tunggu ${waits.printing === null ? 'tidak ada' : duration(waits.printing)}` : row.id === 'press' ? ` · tunggu ${waits.press === null ? 'tidak ada' : duration(waits.press)}` : ` · tunggu ${waits.design === null ? 'tidak ada' : duration(waits.design)}`}</span>
            {row.critical && <span className="block font-semibold text-red-600">Di atas 100%: stasiun tidak sanggup memenuhi permintaan.</span>}
          </Tip>
        </li>
      })}
    </ul>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
      <label className={`group relative inline-flex items-center gap-1.5 ${designAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
        <input type="checkbox" checked={includeDesign && designAvailable} disabled={!designAvailable} onChange={event => setIncludeDesign(event.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />Desain
        {!designAvailable && <Tip side="top">Isi kecepatan desain (order/jam) di Pusat Admin → Waktu kerja.</Tip>}
      </label>
      {waits.admin !== null && <span className="whitespace-nowrap" title="Rata-rata waktu di Menunggu Pembayaran (bukan stasiun produksi)">Tunggu bayar <strong className="text-slate-800">{duration(waits.admin)}</strong></span>}
      {bottleneckRow && bottleneckSpeed !== null && <span className="whitespace-nowrap" title={`Output yang hilang per jam bila ${NAME[bottleneckRow.id]} berhenti`}>Hilang/jam <strong className="text-red-700">−{number.format(bottleneckSpeed)} m</strong></span>}
    </div>
  </div>
}
