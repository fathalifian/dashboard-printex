'use client'

import { useMemo } from 'react'
import { Handshake, Layers, PackageCheck, PackagePlus, PenTool, Printer, Wallet } from 'lucide-react'
import { BOARD_STAGE_META } from '@/lib/production-board'
import { createProductionFlowReader } from '@/lib/production-flow'
import { type ProcessStage } from '@/lib/process-metrics'
import { total, stageCode } from '@/lib/report-summaries'
import { useDashboard } from './dashboard-context'
import { Tip } from './fit'

const STATION_ICONS = { incoming: PackagePlus, design: PenTool, design_done: Wallet, printing: Printer, press: Layers, done: PackageCheck, archive: Handshake }

export function duration(value: number | null) {
  if (value === null) return null
  if (value < 60000) return '< 1 mnt'
  const minutes = Math.floor(value / 60000)
  if (minutes < 60) return `${minutes} mnt`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} j ${minutes % 60} m`
  return `${Math.floor(minutes / 1440)} h ${Math.floor(minutes % 1440 / 60)} j`
}

/** Per stage: order count, average completion time and the current average waiting time. */
export function useFlowStops() {
  const { orders, history, start, end, now, saved } = useDashboard()
  const readFlow = useMemo(() => createProductionFlowReader(orders, history, { start, end }), [orders, history, start, end])
  return useMemo(() => {
    if (!now) return []
    const rows = readFlow(now.getTime()).map(row => {
      if (!saved.enabled) return row
      const sum = total(saved.rows.filter(item => item.dimension === stageCode(row.stage)), 'flow')
      return { ...row, samples: sum.count, total: sum.milliseconds, average: sum.count ? sum.milliseconds / sum.count : null }
    })
    // Archived orders are shown together with "Selesai".
    const archived = rows.find(row => row.stage === 'archive')?.count ?? 0
    return rows.filter(row => row.stage !== 'archive').map(row => ({
      stage: row.stage, name: BOARD_STAGE_META[row.stage].name,
      count: row.count + (row.stage === 'done' ? archived : 0), samples: row.samples,
      average: duration(row.average), averageMs: row.average, bottleneck: row.bottleneck, piling: row.piling,
      // Orders now in the stage: how long they have waited on average.
      waitingMs: row.waiting.length ? row.waiting.reduce((sum, value) => sum + value, 0) / row.waiting.length : null,
    }))
  }, [readFlow, now, saved.enabled, saved.rows])
}

/**
 * The stages as one timeline: a colored marker with the order count above the line,
 * the stage name below. Details (average time, warnings) appear on hover or focus.
 */
export default function FlowStrip({ onSelect, bottleneck = null }: { onSelect: (stage: ProcessStage) => void; bottleneck?: ProcessStage | null }) {
  const stops = useFlowStops()
  const { stage: selected } = useDashboard()
  return <ol className="grid h-full min-h-28 grid-cols-6" aria-label={`Alur ${stops.length} tahap produksi`}>
    {stops.map((stop, index) => {
      const Icon = STATION_ICONS[stop.stage]
      const warning = stop.bottleneck ? 'Proses melambat' : stop.piling ? 'Order menumpuk' : null
      const active = selected === stop.stage
      return <li key={stop.stage} data-route-stage={stop.stage} className="flow-stop min-w-0">
        <button type="button" onClick={() => onSelect(stop.stage)} aria-pressed={active} aria-label={`${stop.name}: ${stop.count} order`}
          className="group relative grid h-full w-full min-w-0 grid-rows-[1fr_auto_1fr] justify-items-center rounded-xl px-1 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="flow-stop-pin relative mb-2.5 flex min-w-12 items-center self-end justify-center gap-1 rounded-lg px-2 py-1 transition-transform group-hover:-translate-y-0.5">
            <Icon aria-hidden="true" className="h-3.5 w-3.5 opacity-90" />
            <strong className="text-[clamp(0.95rem,2.6vh,1.25rem)] font-semibold leading-none tabular-nums">{stop.count}</strong>
            {warning && <span aria-hidden="true" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />}
          </span>
          <span className="relative flex h-4 w-full items-center justify-center">
            <span aria-hidden="true" className={`absolute top-1/2 h-0.5 -translate-y-1/2 bg-slate-200 ${index === 0 ? 'left-1/2 right-0' : index === stops.length - 1 ? 'left-0 right-1/2' : 'inset-x-0'}`} />
            <span aria-hidden="true" className={`flow-stop-node relative h-3.5 w-3.5 rounded-full border-[3px] ${active ? 'flow-stop-node-active' : ''}`} />
          </span>
          <span className={`mt-2 flex flex-col items-center gap-1 self-start text-center text-xs leading-tight ${active ? 'font-semibold text-brand-700' : 'font-medium text-slate-700'}`}>
            <span className="line-clamp-2">{stop.name}</span>
            {bottleneck === stop.stage && <span className="whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">Bottleneck</span>}
          </span>
          <Tip side="bottom">
            <span className="block font-semibold text-slate-900">{stop.name}</span>
            <span className="block">Rata-rata selesai: {stop.average ?? 'belum ada data'}</span>
            <span className="block">Rata-rata tunggu: {stop.waitingMs === null ? 'tidak ada order antre' : duration(stop.waitingMs)}</span>
            {bottleneck === stop.stage && <span className="block font-semibold text-red-600">Beban tertinggi di lini produksi</span>}
            {warning && <span className="block font-semibold text-red-600">{warning}</span>}
            <span className="block text-slate-500">Klik untuk melihat ordernya</span>
          </Tip>
        </button>
      </li>
    })}
  </ol>
}
