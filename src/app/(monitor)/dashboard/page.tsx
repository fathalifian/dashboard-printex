'use client'

import { useMemo, useState } from 'react'
import { ChartColumn, ClipboardList, Info, Route, Settings2 } from 'lucide-react'
import { paperLabel, paperOutput, PAPER_WIDTHS } from '@/lib/paper-output'
import { storedPaper } from '@/lib/report-summaries'
import ReportStatus from '@/components/reports/report-status'
import { useDashboard } from '@/components/dashboard/dashboard-context'
import { EmptyState, Panel, Tabs } from '@/components/dashboard/fit'
import KpiTiles from '@/components/dashboard/kpi-tiles'
import FlowStrip from '@/components/dashboard/flow-strip'
import { Donut, TrendChart } from '@/components/dashboard/fit-charts'
import { CapacityEditor, CapacitySummary } from '@/components/dashboard/capacity'
import MetricDetails from '@/components/dashboard/metric-details'
import { BottleneckView, EfficiencyView, ProductivityView } from '@/components/dashboard/efficiency-views'
import { useProductionMetrics, type ProductionMetrics } from '@/components/dashboard/use-production-metrics'
import { AttentionList, OrderList, type AttentionKind } from '@/components/dashboard/dashboard-lists'

const icon = 'h-4 w-4 text-brand-600'
const PRINT = [{ label: 'DTF', color: '#bb2026' }, { label: 'Sublim', color: '#64748b' }]
const PAPER_COLORS = { '0.6': '#8b5cf6', '1.2': '#0ea5e9', '1.6': '#10b981', '1.8': '#f43f5e' }
const PAPER = PAPER_WIDTHS.map(width => ({ label: paperLabel(width), color: PAPER_COLORS[width] }))
type ListTab = AttentionKind | 'order'

function OutputPanel() {
  const { output, trend, orders, history, start, end, saved } = useDashboard()
  const [tab, setTab] = useState<'print' | 'paper'>('print')
  const paper = useMemo(() => tab !== 'paper' ? null : saved.enabled ? storedPaper(saved.rows, start, end) : paperOutput(orders, history, start, end), [tab, saved.enabled, saved.rows, orders, history, start, end])
  const empty = paper ? PAPER_WIDTHS.every(width => !paper.totals[width].meter) : !output.dtf.meter && !output.sublim.meter
  return <Panel title="Output" icon={<ChartColumn aria-hidden="true" className={icon} />} className="lg:col-span-7"
    aside={<Tabs label="Jenis output" value={tab} onChange={setTab} items={[{ id: 'print', label: 'Print' }, { id: 'paper', label: 'Kertas' }]} />}>
    {empty ? <EmptyState title="Belum ada output" text="Output tampil setelah ada order yang selesai print pada periode ini." />
      : <div className="grid h-full min-h-0 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {paper ? <>
          <TrendChart label="Tren output kertas per lebar, meter per hari" series={PAPER} days={paper.trend.map(day => ({ day: day.day, values: PAPER_WIDTHS.map(width => day.values[width].meter) }))} />
          <Donut label="Komposisi output kertas" segments={PAPER_WIDTHS.map((width, index) => ({ ...PAPER[index], value: paper.totals[width].meter }))} />
        </> : <>
          <TrendChart label="Tren output print, meter per hari" series={PRINT} days={trend.map(day => ({ day: day.day, values: [day.dtf.meter, day.sublim.meter] }))} />
          <Donut label="Komposisi output print" segments={[{ ...PRINT[0], value: output.dtf.meter }, { ...PRINT[1], value: output.sublim.meter }]} />
        </>}
      </div>}
  </Panel>
}

const VIEWS = [{ id: 'capacity', label: 'Kapasitas' }, { id: 'productivity', label: 'Produktivitas' }, { id: 'efficiency', label: 'Efisiensi' }, { id: 'bottleneck', label: 'Bottleneck' }] as const
export type MetricView = typeof VIEWS[number]['id']

function CapacityPanel({ metrics }: { metrics: ProductionMetrics }) {
  const [details, setDetails] = useState(false)
  const [editing, setEditing] = useState(false)
  const [view, setView] = useState<MetricView>('capacity')
  const { capacity } = metrics
  return <Panel title={<Tabs label="Indikator produksi" value={view} onChange={setView} items={VIEWS} />} className="lg:col-span-5" bodyClassName="px-4 py-3"
    aside={<div className="flex items-center gap-1.5">
      <button type="button" onClick={() => setDetails(true)} aria-label="Rincian perhitungan" title="Rincian perhitungan" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-brand-700 hover:bg-brand-50"><Info aria-hidden="true" className="h-4 w-4" /></button>
      {capacity.canEdit && <button type="button" onClick={() => setEditing(true)} aria-label="Atur mesin dan waktu kerja" title="Atur mesin & waktu kerja" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><Settings2 aria-hidden="true" className="h-3.5 w-3.5" /></button>}
    </div>}>
    {view === 'capacity' ? <CapacitySummary capacity={capacity} /> : view === 'productivity' ? <ProductivityView metrics={metrics} /> : view === 'efficiency' ? <EfficiencyView metrics={metrics} /> : <BottleneckView metrics={metrics} />}
    {details && <MetricDetails metrics={metrics} initialView={view} onClose={() => setDetails(false)} />}
    {editing && <CapacityEditor onClose={() => setEditing(false)} onSaved={() => { capacity.reloadSettings(); metrics.reload() }} />}
  </Panel>
}

export default function DashboardPage() {
  const dashboard = useDashboard()
  const { saved, ready, message, overdue, dueInPeriod } = dashboard
  const [listTab, setListTab] = useState<ListTab>('late')
  const metrics = useProductionMetrics(dashboard.paperWidth)
  const tabs = [
    { id: 'late', label: 'Terlambat', count: overdue.length },
    { id: 'period', label: 'Tenggat', count: dueInPeriod.length },
    { id: 'longest', label: 'Terlama' },
    { id: 'order', label: 'Semua' },
  ] as { id: ListTab; label: string; count?: number }[]
  if (!ready) return <div className="flex h-full flex-col gap-3">
    {saved.enabled && saved.error && <ReportStatus report={saved} />}
    <p role="status" className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{message}</p>
  </div>
  return <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
    <KpiTiles output={dashboard.output} pending={dashboard.pendingOrders.length} overdue={overdue.length} efficiency={metrics.capacity.result.system.efficiency} labor={metrics.recorded ? metrics.labor?.perManHour ?? null : undefined} laborGrowth={metrics.growth.perManHour} />
    {/* Two rows of panels share the remaining height, so the page never scrolls. */}
    <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel title="Alur produksi" icon={<Route aria-hidden="true" className={icon} />} className="lg:col-span-7" bodyClassName="p-2.5">
        <FlowStrip bottleneck={metrics.bottleneckStage} onSelect={stage => { dashboard.setStage(stage); setListTab('order') }} />
      </Panel>
      <CapacityPanel metrics={metrics} />
      <OutputPanel />
      <Panel title={<span className="sr-only xl:not-sr-only">Order</span>} icon={<ClipboardList aria-hidden="true" className={icon} />} className="lg:col-span-5" bodyClassName=""
        aside={<Tabs label="Daftar order" value={listTab} onChange={setListTab} items={tabs} />}>
        {listTab === 'order' ? <OrderList /> : <AttentionList key={listTab} kind={listTab} />}
      </Panel>
    </div>
  </div>
}
