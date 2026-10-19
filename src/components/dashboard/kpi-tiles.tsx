import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { roundTo } from '@/lib/production-efficiency'
import { usageStatus } from './capacity'
import { Growth, HINTS, Missing } from './efficiency-views'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 })
const one = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
type Output = { meter: number; count: number }

// Label, one large figure, one short detail; the late tile turns solid brand red when action is needed.
function Tile({ kind, label, value, unit, detail, dot, alert = false }: {
  kind: string; label: string; value: ReactNode; unit?: string; detail?: ReactNode; dot: string; alert?: boolean
}) {
  return <section data-output={kind} aria-label={label} className={`daily-output-card min-w-0 rounded-2xl border px-4 py-3 ${alert ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white'}`}>
    <p className={`flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wider ${alert ? 'text-white/85' : 'text-slate-500'}`}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: alert ? '#fff' : dot }} />{label}</p>
    <div className="mt-1 flex min-h-8 items-baseline gap-1.5">
      {typeof value === 'string' ? <strong className={`text-[clamp(1.5rem,4.5vh,2.25rem)] font-semibold leading-none tracking-tight tabular-nums ${alert ? 'text-white' : 'text-slate-900'}`}>{value}</strong> : <span className="self-center">{value}</span>}
      {unit && typeof value === 'string' && <span className={`whitespace-nowrap text-sm ${alert ? 'text-white/85' : 'text-slate-500'}`}>{unit}</span>}
    </div>
    <div className={`mt-0.5 min-h-4 truncate text-xs ${alert ? 'text-white/90' : 'text-slate-500'}`}>{detail}</div>
  </section>
}

/**
 * Headline numbers. Efficiency = actual ÷ line capacity (null without data). Labour productivity:
 * undefined = records unavailable (migration 0014 missing), null = not recorded yet in this period.
 */
export default function KpiTiles({ output, pending, overdue, efficiency, labor, laborGrowth = null }: {
  output: { dtf: Output; sublim: Output }; pending: number; overdue: number
  efficiency: number | null; labor?: number | null; laborGrowth?: number | null
}) {
  return <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-live="polite">
    <Tile kind="sublim" dot="#64748b" label="Output Sublim" value={number.format(output.sublim.meter)} unit="m" detail={`${output.sublim.count} order`} />
    <Tile kind="dtf" dot="#bb2026" label="Output DTF" value={number.format(output.dtf.meter)} unit="m" detail={`${output.dtf.count} order`} />
    <Tile kind="pending" dot="#f59e0b" label="Dalam proses" value={number.format(pending)} unit="order" />
    <Tile kind="late" dot="#10b981" label="Terlambat" value={number.format(overdue)} unit="order" alert={overdue > 0}
      detail={overdue > 0 ? <span className="inline-flex items-center gap-1"><AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />Tindak lanjuti</span>
        : <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />Aman</span>} />
    <Tile kind="efficiency" dot="#8b5cf6" label="Efisiensi lini" unit="%"
      value={efficiency === null ? <span className="text-xs font-medium text-slate-500">Belum ada data</span> : one.format(roundTo(efficiency * 100))}
      detail={efficiency !== null && <span className={usageStatus(efficiency)!.text}>{usageStatus(efficiency)!.label}</span>} />
    <Tile kind="labor" dot="#0ea5e9" label="Produktivitas" unit="m/jam/orang"
      value={labor === undefined ? <Missing hint={HINTS.migration} /> : labor === null ? <Missing hint={HINTS.shifts + ' ' + HINTS.runs} /> : number.format(labor)}
      detail={labor !== undefined && labor !== null && <Growth value={laborGrowth} />} />
  </div>
}
