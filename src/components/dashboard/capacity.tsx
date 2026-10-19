'use client'

import { useDailySummary, total } from '@/lib/report-summaries'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, TrendingDown, X } from 'lucide-react'
import type { ProcessEvent } from '@/lib/process-metrics'
import { productivityRows, type ProductivityOrder, type ProductivityPaperWidth } from '@/lib/productivity'
import {
  CAPACITY_PROCESSES, DEFAULT_CAPACITY_SETTINGS, daysInRange, defaultMachines, parseCapacityRow, productionCapacity,
  type CapacityProcess, type CapacitySettings, type ProcessMeasure,
} from '@/lib/production-capacity'
import type { RunTotal } from '@/lib/production-metrics'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { createClient } from '@/lib/supabase/client'
import { useMachines } from '@/lib/machines-store'
import { EmptyState, Tip } from './fit'
import MachineSettings from '@/components/settings/machine-settings'
import WorkingHoursSettings from '@/components/settings/working-hours-settings'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const SHORT: Record<CapacityProcess, string> = { sublim: 'Sublim', dtf: 'DTF', press: 'Press' }

// Missing values read as 0, never as a dash.
export const display = (value: number | null) => value === null ? '0' : number.format(value)
const rounded = (value: number | null) => display(value === null ? null : Math.round(value))
// Paper width narrows Sublim/Press rows; DTF stays independently reportable.
// Pressed DTF ('press:dtf') runs on its own press line and is left out of the Press station.
const matchesWidth = (dimension: string, process: CapacityProcess, width: ProductivityPaperWidth) =>
  dimension.startsWith(process + ':') && dimension !== 'press:dtf' && (width === 'all' || process === 'dtf' || dimension.endsWith(':' + width))
const add = (measure: ProcessMeasure | undefined, meter: number, milliseconds: number, count: number): ProcessMeasure =>
  ({ meter: (measure?.meter ?? 0) + meter, milliseconds: (measure?.milliseconds ?? 0) + milliseconds, count: (measure?.count ?? 0) + count })
const measured = (measure?: ProcessMeasure): measure is ProcessMeasure => !!measure && measure.meter > 0 && measure.milliseconds > 0

/** Working time and standard crew (Pusat Admin → Waktu kerja), refreshed every minute and on focus. */
function useCapacitySettings() {
  const [state, setState] = useState<{ settings: CapacitySettings; available: boolean }>({ settings: DEFAULT_CAPACITY_SETTINGS, available: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const { data, error } = await createClient().from('production_settings').select('*').maybeSingle()
      if (cancelled) return
      if (error || !data) { setState({ settings: DEFAULT_CAPACITY_SETTINGS, available: false }); return }
      try { setState({ settings: parseCapacityRow(data), available: true }) } catch { setState({ settings: DEFAULT_CAPACITY_SETTINGS, available: false }) }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [revision])
  return { ...state, reload: () => setRevision(value => value + 1) }
}

type MachineRow = { machineId: string; dimension: string; count: number; meter: number; milliseconds: number }
/** Saved-report mode: per-machine totals from saved stage times. */
function useMachineProductivity(start: string, end: string, active: boolean, refreshKey?: number) {
  const key = active ? `${start}|${end}|${refreshKey ?? ''}` : ''
  const [state, setState] = useState<{ key: string; rows: MachineRow[] }>({ key: '', rows: [] })
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void createClient().rpc('printex_machine_productivity', { p_start: start, p_end: end }).then(({ data, error }) => {
      if (!cancelled) setState({ key, rows: error || !Array.isArray(data) ? [] : data as MachineRow[] })
    })
    return () => { cancelled = true }
  }, [key, start, end])
  return state.key === key ? state.rows : []
}

/** K = P × T per machine, station and Sublim → Press line for the selected period. */
export function useCapacity({ orders, history, start, end, paperWidth = 'all', runs = null }: {
  orders: ProductivityOrder[]; history: ProcessEvent[]; start: string; end: string; paperWidth?: ProductivityPaperWidth
  /** Mulai/Selesai records of the period; machine time without the wait in a column. */
  runs?: readonly RunTotal[] | null
}) {
  const connection = useOnlineConnection()
  const saved = useDailySummary(start, end)
  const capacitySettings = useCapacitySettings()
  const machineState = useMachines()
  const machines = useMemo(() => machineState.available ? machineState.machines : defaultMachines(), [machineState.available, machineState.machines])
  const validRange = Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && start <= end
  const days = validRange ? daysInRange(start, end) : 0
  const rows = useMemo(() => saved.enabled ? null : productivityRows(orders, history, start, end, paperWidth), [orders, history, start, end, paperWidth, saved.enabled])
  const savedMachineRows = useMachineProductivity(start, end, saved.enabled && machineState.available && validRange, saved.asOf ? Date.parse(saved.asOf) : undefined)
  const result = useMemo(() => {
    // P and output from stage times (time an order spends in the column).
    const stations: Partial<Record<CapacityProcess, ProcessMeasure>> = {}
    const machineMeasures = new Map<string, ProcessMeasure>()
    for (const process of CAPACITY_PROCESSES) {
      stations[process] = rows ? rows[process].reduce<ProcessMeasure>((sum, row) => add(sum, row.meter, row.durationMilliseconds, 1), { meter: 0, milliseconds: 0, count: 0 })
        : total(saved.rows.filter(row => matchesWidth(row.dimension, process, paperWidth)), 'productivity')
    }
    if (rows) for (const process of ['sublim', 'dtf'] as const) for (const row of rows[process]) {
      if (row.machineId) machineMeasures.set(row.machineId, add(machineMeasures.get(row.machineId), row.meter, row.durationMilliseconds, 1))
    }
    else for (const row of savedMachineRows) {
      const process = row.dimension.startsWith('dtf:') ? 'dtf' : 'sublim'
      if (matchesWidth(row.dimension, process, paperWidth)) machineMeasures.set(row.machineId, add(machineMeasures.get(row.machineId), Number(row.meter), Number(row.milliseconds), Number(row.count)))
    }
    // Stage time includes waiting in the column (e.g. a Press queue overnight). Where runs are
    // recorded, P and output come from machine time instead. Runs carry no paper width.
    if (runs && paperWidth === 'all') {
      const kindOf = new Map(machines.map(machine => [machine.id, machine.kind]))
      const recorded: Partial<Record<CapacityProcess, ProcessMeasure>> = {}
      const byMachine = new Map<string, ProcessMeasure>()
      for (const run of runs) {
        const kind = run.machineId ? kindOf.get(run.machineId) : undefined
        const process: CapacityProcess | null = run.stage === 'press' ? 'press' : kind === 'fedar' ? 'sublim' : kind === 'dtf' ? 'dtf' : null
        if (!process) continue
        recorded[process] = add(recorded[process], run.meter, run.milliseconds, run.count)
        if (run.machineId && process !== 'press') byMachine.set(run.machineId, add(byMachine.get(run.machineId), run.meter, run.milliseconds, run.count))
      }
      for (const process of CAPACITY_PROCESSES) if (measured(recorded[process])) stations[process] = recorded[process]
      for (const [machineId, measure] of byMachine) if (measured(measure)) machineMeasures.set(machineId, measure)
    }
    return productionCapacity({ stations, machines, machineMeasures, settings: capacitySettings.settings, days })
  }, [rows, saved.rows, savedMachineRows, paperWidth, machines, capacitySettings.settings, days, runs])
  return {
    result,
    settings: capacitySettings.settings,
    days,
    canEdit: canManageOrders(connection.profile?.role) && capacitySettings.available,
    reloadSettings: capacitySettings.reload,
  }
}
export type Capacity = ReturnType<typeof useCapacity>

/**
 * Utilization bands (actual output ÷ capacity): idle below 70%, ideal at 80–85%,
 * unsustainable from 90%. Colors always travel with an icon and a text label.
 */
export const USAGE_BANDS = [
  { min: 0.9, label: 'Penuh', hint: 'Tidak berkelanjutan: risiko kerusakan mesin, lembur, turun kualitas, dan terlambat kirim. Pertimbangkan menambah kapasitas.', color: '#ef4444', text: 'text-red-700', Icon: AlertTriangle },
  { min: 0.85, label: 'Padat', hint: 'Sangat efisien, tetapi waktu perawatan dan fleksibilitas mulai tertekan.', color: '#f97316', text: 'text-orange-700', Icon: AlertTriangle },
  { min: 0.8, label: 'Ideal', hint: 'Zona ideal untuk kebanyakan industri.', color: '#10b981', text: 'text-emerald-700', Icon: CheckCircle2 },
  { min: 0.7, label: 'Cukup', hint: 'Masih ada ruang untuk ditingkatkan.', color: '#14b8a6', text: 'text-teal-700', Icon: CheckCircle2 },
  { min: 0, label: 'Rendah', hint: 'Biaya tetap per meter tinggi; bisa tanda permintaan lemah atau ada masalah di proses.', color: '#f59e0b', text: 'text-amber-700', Icon: TrendingDown },
] as const
export function usageStatus(value: number | null) {
  return value === null ? null : USAGE_BANDS.find(band => value >= band.min)!
}
const percentText = (value: number) => `${number.format(Math.round(value * 100))}%`

export function StatusPill({ value }: { value: number | null }) {
  const status = usageStatus(value)
  if (!status || value === null) return null
  return <span title={status.hint} className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${status.text}`}><status.Icon aria-hidden="true" className="h-3.5 w-3.5" />{percentText(value)} · {status.label}</span>
}

function StatusLabel({ value }: { value: number }) {
  const status = usageStatus(value)!
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold ${status.text}`}><status.Icon aria-hidden="true" className="h-3 w-3" />{status.label}</span>
}

/** Ring for a share (utilization or efficiency), colored by status. Without a value it shows the placeholder. */
export function Ring({ value, label, empty = '0%' }: { value: number | null; label: string; empty?: string }) {
  const status = usageStatus(value)
  const share = value === null ? 0 : Math.min(100, value * 100)
  return <div className="relative aspect-square h-full max-h-24 min-h-14">
    <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={value === null ? `${label}: belum ada data` : `${label}: ${percentText(value)}, ${status!.label}`}>
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" strokeWidth="11" />
      {share > 0 && <circle cx="50" cy="50" r="40" fill="none" stroke={status!.color} strokeWidth="11" strokeLinecap="round" pathLength="100" strokeDasharray={`${share} 100`} />}
    </svg>
    <span className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-slate-900 ${value === null && empty.length > 3 ? 'px-2 text-center text-[10px] leading-tight text-slate-500' : 'text-sm'}`}>{value === null ? empty : percentText(value)}</span>
  </div>
}

export const STATIONS: { process: CapacityProcess; name: string }[] = [
  { process: 'sublim', name: 'Sublim' },
  { process: 'press', name: 'Press' },
  { process: 'dtf', name: 'DTF' },
]
export const noCapacity = (capacity: Capacity) => capacity.result.system.capacity === null && STATIONS.every(({ process }) => capacity.result.processes[process].capacity === null)

/** One ring per station: `measure` picks utilization (Kapasitas tab) or efficiency (Efisiensi tab). */
export function StationRings({ capacity, measure }: { capacity: Capacity; measure: 'utilization' | 'efficiency' }) {
  const { system, processes } = capacity.result
  return <ul className="grid min-h-0 flex-1 grid-cols-3 gap-2" aria-label={measure === 'utilization' ? 'Utilisasi per stasiun' : 'Efisiensi per stasiun'}>
    {STATIONS.map(({ process, name }) => {
      const item = processes[process], value = item[measure]
      return <li key={process} tabIndex={0} className="group relative flex min-h-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        <div className="flex min-h-0 w-full flex-1 justify-center"><Ring value={value} label={name} /></div>
        <p className="flex items-center gap-1 text-xs font-semibold text-slate-800">{name}{system.bottleneck === process && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="Pembatas lini" />}</p>
        <p className="text-[11px] tabular-nums text-slate-500">{measure === 'utilization' ? `${rounded(item.capacity)} m/hari` : `${rounded(item.dailyOutput)} / ${rounded(item.capacity)} m`}</p>
        {value !== null && <StatusLabel value={value} />}
        <Tip side="top">
          <span className="block font-semibold text-slate-900">{name}</span>
          {item.capacity === null ? <span className="block">Belum ada data pada periode ini</span> : <>
            <span className="block">Kapasitas desain {rounded(item.designCapacity)} · efektif {rounded(item.capacity)} m/hari</span>
            <span className="block">Output aktual {rounded(item.dailyOutput)} m/hari</span>
            <span className="block">{measure === 'utilization' ? 'Utilisasi = aktual ÷ desain' : 'Efisiensi = aktual ÷ kapasitas efektif'}</span>
            {value !== null && <span className={`mt-1 block font-semibold ${usageStatus(value)!.text}`}>{usageStatus(value)!.label}<span className="block font-normal text-slate-600">{usageStatus(value)!.hint}</span></span>}
          </>}
        </Tip>
      </li>
    })}
  </ul>
}

/** Kapasitas tab: line capacity, design vs actual, and utilization per station. */
export function CapacitySummary({ capacity }: { capacity: Capacity }) {
  const { system } = capacity.result
  if (noCapacity(capacity)) return <EmptyState title="Belum ada data" text="Belum ada order selesai pada periode ini." />
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" title="Sublim → Press, nilai terendah">Kapasitas lini</p>
        <p className="mt-1 flex items-baseline gap-1.5"><strong className="text-[clamp(1.5rem,4.5vh,2.25rem)] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{rounded(system.capacity)}</strong><span className="text-sm text-slate-500">m/hari</span></p>
      </div>
      <div className="space-y-0.5 text-right text-xs">
        <p className="whitespace-nowrap tabular-nums text-slate-500" title="Kapasitas desain = produktivitas × jam tersedia">Desain {rounded(system.designCapacity)} m</p>
        <p className="whitespace-nowrap tabular-nums text-slate-500">Aktual {rounded(system.dailyOutput)} m</p>
        {system.bottleneck && <p className="text-slate-500">Pembatas <strong className="text-slate-800">{SHORT[system.bottleneck]}</strong></p>}
      </div>
    </div>
    <StationRings capacity={capacity} measure="utilization" />
  </div>
}

/** Measured productivity (P) per station from stage times: the fallback when no runs are recorded. */
export function ProductivityBars({ capacity }: { capacity: Capacity }) {
  const rows = STATIONS.map(({ process, name }) => ({ process, name, productivity: capacity.result.processes[process].productivity }))
  if (rows.every(row => row.productivity === null)) return <EmptyState title="Belum ada data" text="Belum ada order selesai pada periode ini." />
  const peak = Math.max(1, ...rows.map(row => row.productivity ?? 0))
  return <ul className="space-y-2" aria-label="Produktivitas per stasiun">
    {rows.map(row => <li key={row.process} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <span className="font-medium text-slate-700">{row.name}</span>
      <span className="h-2 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-slate-500" style={{ width: `${(row.productivity ?? 0) / peak * 100}%` }} /></span>
      <span className="whitespace-nowrap tabular-nums text-slate-600"><strong className="text-slate-900">{display(row.productivity)}</strong> m/jam</span>
    </li>)}
  </ul>
}

export function CapacityEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { dialog.current?.close(); onClose() }
  return <dialog ref={dialog} aria-labelledby="capacity-editor-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-950/50">
    <div className="mb-5 flex items-center justify-between gap-3"><h2 id="capacity-editor-title" className="font-semibold text-slate-900">Mesin &amp; waktu kerja</h2><button type="button" onClick={close} aria-label="Tutup pengaturan kapasitas" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"><X size={18} /></button></div>
    <MachineSettings framed={false} />
    <div className="mt-5 border-t border-slate-100 pt-5"><WorkingHoursSettings onSaved={onSaved} /></div>
    <p className="mt-4 text-xs text-slate-500">Semua pengaturan lain tersedia di <a href="/admin" className="font-medium text-brand-600 hover:underline">Pusat Admin</a>.</p>
  </dialog>
}
