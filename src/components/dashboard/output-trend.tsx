import { memo } from 'react'
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function OutputTrend({ title, scope, series, days, empty }: {
  title: string
  scope: string
  series: { label: string; color: string }[]
  days: { day: string; values: number[] }[]
  empty: boolean
}) {
  const ceiling = Math.ceil(Math.max(1, ...days.flatMap(day => day.values)) / 4) * 4
  return <>
    <header>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{scope} · meter</p>
      <div className="mt-4 grid min-h-12 grid-cols-2 auto-rows-6 content-start gap-x-3 text-xs text-slate-600">
        {series.map(item => <span key={item.label} className="flex items-center gap-2 whitespace-nowrap"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}
      </div>
    </header>
    <div className="mt-4 flex gap-3">
      <div aria-hidden="true" className="mt-6 flex h-48 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-slate-500">
        {[4, 3, 2, 1, 0].map(tick => <span key={tick}>{number.format(ceiling * tick / 4)}</span>)}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto pb-2 pt-6" tabIndex={0} role="region" aria-label={`${title}. Geser untuk melihat tanggal lainnya.`}>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(160px, 1fr))` }}>
          {days.map(day => <div key={day.day}>
            <div className="flex h-48 items-end justify-center gap-2 border-b border-slate-200 bg-[repeating-linear-gradient(to_top,transparent_0,transparent_calc(25%_-_1px),var(--line)_25%)]">
              {series.map((item, index) => <div key={item.label} className="relative w-7 shrink-0 rounded-t-sm" title={`${day.day} / ${item.label}: ${number.format(day.values[index])} meter`} style={{ height: `${day.values[index] / ceiling * 100}%`, background: item.color }}>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-slate-600">{number.format(day.values[index])}</span>
              </div>)}
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">{date.format(new Date(day.day + 'T12:00:00Z'))}</p>
          </div>)}
        </div>
      </div>
    </div>
    {empty && <p className="mt-4 text-center text-xs text-slate-500">Belum ada output.</p>}
  </>
}

export default memo(OutputTrend)
