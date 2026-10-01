import { memo } from 'react'
import OutputTrend from '@/components/dashboard/output-trend'
import { PAPER_WIDTHS, paperLabel, type paperOutput } from '@/lib/paper-output'
import type { ReactNode } from 'react'
import type { centralDashboard } from '@/lib/central-dashboard'

type Data = ReturnType<typeof centralDashboard>
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const panel = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const paperColors = { '0.6':'#8b5cf6', '1.2': '#0ea5e9', '1.6': '#10b981', '1.8': '#f43f5e' }
const colors = { dtf: '#bb2026', sublim: '#64748b' }

function Legend() {
  return <div className="flex gap-4 text-xs text-slate-600">{(['dtf', 'sublim'] as const).map(kind => <span key={kind} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[kind] }} />{kind === 'dtf' ? 'DTF' : 'Sublim'}</span>)}</div>
}

function CentralCharts({ data, scope, onBranch, paperCharts, branchPaper = {} }: { data: Pick<Data, 'output' | 'trend' | 'rows'>; scope: string; onBranch?: (id: string) => void; paperCharts: ReactNode; branchPaper?: Record<string, ReturnType<typeof paperOutput>['totals']> }) {
  const total = data.output.dtf.meter + data.output.sublim.meter
  const share = total ? data.output.dtf.meter / total * 100 : 0
  const branches = [...data.rows].sort((a, b) => (b.output.dtf.meter + b.output.sublim.meter) - (a.output.dtf.meter + a.output.sublim.meter))
  const branchPeak = Math.max(1, ...branches.map(row => row.output.dtf.meter + row.output.sublim.meter))
  const paperPeak = Math.max(1,...Object.values(branchPaper).map(totals=>PAPER_WIDTHS.reduce((sum,width)=>sum+totals[width].meter,0)))
  return <div className="grid min-w-0 gap-5 xl:grid-cols-4">
    <section className={panel + ' xl:col-start-1 xl:row-start-1'}>
      <OutputTrend title="Tren output print" scope={scope}
        series={[{ label: 'DTF', color: colors.dtf }, { label: 'Sublim', color: colors.sublim }]}
        days={data.trend.map(day => ({ day: day.day, values: [day.dtf.meter, day.sublim.meter] }))}
        empty={!total} />
    </section>
    <section className={panel + ' xl:col-start-2 xl:row-start-1'}>
      <h3 className="font-semibold text-slate-900">Komposisi output</h3>
      <div className="relative mx-auto my-6 h-44 w-44">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={total ? `DTF ${number.format(share)} persen, Sublim ${number.format(100 - share)} persen` : 'Belum ada output'}><circle cx="60" cy="60" r="48" fill="none" stroke="var(--line)" strokeWidth="14" />{total > 0 && <><circle cx="60" cy="60" r="48" fill="none" stroke={colors.sublim} strokeWidth="14" /><circle cx="60" cy="60" r="48" fill="none" stroke={colors.dtf} strokeWidth="14" pathLength="100" strokeDasharray={`${share} ${100 - share}`} /></>}</svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-slate-500">Total output</span><strong className="mt-1 max-w-32 break-all text-center text-2xl tabular-nums text-slate-900">{number.format(total)}</strong><span className="text-xs text-slate-500">meter</span></div>
      </div>
      <div className="space-y-3">{(['dtf', 'sublim'] as const).map(kind => <div key={kind} className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[kind] }} /><span className="text-slate-600">{kind === 'dtf' ? 'DTF' : 'Sublim'}</span><strong className="ml-auto tabular-nums text-slate-900">{number.format(data.output[kind].meter)} m</strong><span className="w-14 text-right text-xs text-slate-500">{total ? number.format(data.output[kind].meter / total * 100) + '%' : '—'}</span></div>)}</div>
    </section>
    <div className="contents">{paperCharts}</div>
    {onBranch && <section className={panel + ' xl:col-span-4'}>
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Output per cabang</h3></div><Legend /></div>
      <div className={"mt-5 grid gap-x-8 gap-y-5"+(branches.length>1?" md:grid-cols-2 xl:grid-cols-3":"")}>{branches.map(branch => <button key={branch.id} type="button" onClick={() => onBranch(branch.id)} className="min-w-0 rounded-lg p-2 text-left transition-colors hover:bg-slate-50"><span className="mb-2 flex items-start justify-between gap-3 text-sm"><span className="font-medium text-slate-900">{branch.name}</span><strong className="shrink-0 tabular-nums text-slate-900">{number.format(branch.output.dtf.meter + branch.output.sublim.meter)} m</strong></span><span className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{(['dtf', 'sublim'] as const).map(kind => <span key={kind} style={{ width: `${branch.output[kind].meter / branchPeak * 100}%`, background: colors[kind] }} />)}</span><span className="mt-2 block text-xs text-slate-500">DTF {number.format(branch.output.dtf.meter)} m · Sublim {number.format(branch.output.sublim.meter)} m</span>
        <span className="mb-2 mt-4 flex items-center justify-between gap-3 text-xs text-slate-600"><span>Output kertas</span><strong className="tabular-nums text-slate-900">{number.format(PAPER_WIDTHS.reduce((sum,width)=>sum+(branchPaper[branch.id]?.[width].meter??0),0))} m</strong></span>
        <span className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{PAPER_WIDTHS.map(width=><span key={width} style={{width:`${(branchPaper[branch.id]?.[width].meter??0)/paperPeak*100}%`,background:paperColors[width]}} />)}</span>
        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">{PAPER_WIDTHS.map(width=><span key={width} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{background:paperColors[width]}} />{paperLabel(width)}: {number.format(branchPaper[branch.id]?.[width].meter??0)} m</span>)}</span>
        {(branchPaper[branch.id]?.unknown.count??0)>0 && <span className="mt-2 block text-xs text-slate-500">Lebar belum diisi: {number.format(branchPaper[branch.id].unknown.meter)} m (di luar bar kertas).</span>}
      </button>)}</div>
      {!branches.length && <p className="py-8 text-center text-sm text-slate-500">Belum ada cabang.</p>}
    </section>}
  </div>
}

export default memo(CentralCharts)
