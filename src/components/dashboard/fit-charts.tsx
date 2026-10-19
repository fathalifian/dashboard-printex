'use client'

import { memo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useSize } from './fit'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 })
const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayLabel = (day: string) => date.format(new Date(day + 'T12:00:00Z'))
type Series = { label: string; color: string }

export function Legend({ series }: { series: Series[] }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">{series.map(item => <span key={item.label} className="flex items-center gap-1.5 whitespace-nowrap"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div>
}

function niceMax(value: number) {
  if (value <= 0) return 4
  const step = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / step * 2) / 2 * step
}

// Horizontal tangents at every point: smooth like the reference, never overshooting below zero.
function smooth(points: [number, number][]) {
  return points.map(([x, y], index) => {
    if (!index) return `M${x},${y}`
    const [px, py] = points[index - 1]
    const mid = (px + x) / 2
    return `C${mid},${py} ${mid},${y} ${x},${y}`
  }).join(' ')
}

const PAD = { left: 38, right: 10, top: 12, bottom: 22 }

/**
 * Daily trend drawn in pixels so it always fills its box: a smooth line with a soft
 * area per series, or grouped bars for a single day. Hover, touch or arrow keys show
 * every series value of that day.
 */
function TrendChartBase({ series, days, label, unit = 'm' }: { series: Series[]; days: { day: string; values: number[] }[]; label: string; unit?: string }) {
  const [box, { width, height }] = useSize()
  const [active, setActive] = useState<number | null>(null)
  const peak = Math.max(0, ...days.flatMap(day => day.values))
  // Counts (orders) keep whole-number gridlines; meters use a rounded scale.
  const max = unit === 'm' ? niceMax(peak) : Math.max(4, Math.ceil(peak / 4) * 4)
  const plotWidth = Math.max(0, width - PAD.left - PAD.right), plotHeight = Math.max(0, height - PAD.top - PAD.bottom)
  const single = days.length === 1
  const x = (index: number) => single ? PAD.left + plotWidth / 2 : PAD.left + index / (days.length - 1) * plotWidth
  const y = (value: number) => PAD.top + plotHeight - value / max * plotHeight
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotWidth / 56))))
  function pick(event: PointerEvent<SVGSVGElement>) {
    const left = event.clientX - event.currentTarget.getBoundingClientRect().left
    setActive(single ? 0 : Math.min(days.length - 1, Math.max(0, Math.round((left - PAD.left) / plotWidth * (days.length - 1)))))
  }
  function keys(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setActive(current => Math.min(days.length - 1, Math.max(0, (current ?? (event.key === 'ArrowLeft' ? days.length : -1)) + (event.key === 'ArrowLeft' ? -1 : 1))))
  }
  const bar = Math.min(40, plotWidth / (series.length * 2.5))
  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active), 80), Math.max(80, width - 80))
  return <div className="flex h-full min-h-44 flex-col gap-2 lg:min-h-0">
    <Legend series={series} />
    <div ref={box} className="relative min-h-0 flex-1">
      {width > 0 && height > 0 && <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={keys}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)} className="block touch-none outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500">
        {[0, 1, 2, 3, 4].map(tick => <g key={tick}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(max * tick / 4)} y2={y(max * tick / 4)} stroke="var(--line)" strokeDasharray={tick ? '3 4' : undefined} />
          <text x={PAD.left - 8} y={y(max * tick / 4)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--muted)">{number.format(max * tick / 4)}</text>
        </g>)}
        {days.map((day, index) => index % every === 0 && <text key={day.day} x={x(index)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{dayLabel(day.day)}</text>)}
        {active !== null && !single && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--muted)" strokeOpacity="0.5" />}
        {single ? series.map((item, index) => {
          const value = days[0].values[index], left = x(0) - series.length * (bar + 4) / 2 + index * (bar + 4)
          return <rect key={item.label} x={left} y={y(value)} width={bar} height={Math.max(0, PAD.top + plotHeight - y(value))} rx="4" fill={item.color} opacity={active === null ? 1 : 0.85} />
        }) : series.map((item, index) => {
          const points = days.map((day, dayIndex) => [x(dayIndex), y(day.values[index])] as [number, number])
          const line = smooth(points)
          return <g key={item.label}>
            <path d={`${line} L${points[points.length - 1][0]},${PAD.top + plotHeight} L${points[0][0]},${PAD.top + plotHeight} Z`} fill={item.color} fillOpacity="0.1" />
            <path d={line} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {(days.length <= 14 || active !== null) && points.map(([px, py], dayIndex) => (days.length <= 14 || dayIndex === active) && <circle key={dayIndex} cx={px} cy={py} r={dayIndex === active ? 5 : 3.5} fill={item.color} stroke="var(--panel)" strokeWidth="2" />)}
          </g>
        })}
      </svg>}
      {active !== null && <div role="status" className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg" style={{ left: tipLeft }}>
        <p className="mb-1 font-semibold text-slate-900">{dayLabel(days[active].day)}</p>
        {series.map((item, index) => <p key={item.label} className="flex items-center gap-1.5 whitespace-nowrap text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}<strong className="ml-auto pl-3 tabular-nums text-slate-900">{number.format(days[active].values[index])} {unit}</strong></p>)}
      </div>}
    </div>
  </div>
}
export const TrendChart = memo(TrendChartBase)

/** Donut with a 2px gap between segments; hovering a segment or legend row shows it in the middle. */
function DonutBase({ segments, label }: { segments: (Series & { value: number })[]; label: string }) {
  const [active, setActive] = useState<string | null>(null)
  const sum = segments.reduce((total, segment) => total + segment.value, 0)
  const visible = segments.filter(segment => segment.value > 0).length
  const arcs = segments.map((segment, index) => ({ ...segment, share: sum ? segment.value / sum * 100 : 0, offset: sum ? segments.slice(0, index).reduce((total, item) => total + item.value, 0) / sum * 100 : 0 }))
  const focus = arcs.find(arc => arc.label === active)
  return <div className="flex h-full min-h-40 items-center gap-4 lg:min-h-0" onPointerLeave={() => setActive(null)}>
    <div className="relative aspect-square h-full max-h-52 min-h-0 min-w-0 max-w-[50%] shrink">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={sum ? segments.map(segment => `${segment.label} ${number.format(segment.value / sum * 100)} persen`).join(', ') : `${label}: belum ada output`}>
        <circle cx="60" cy="60" r="46" fill="none" stroke="var(--line)" strokeWidth="14" />
        {arcs.filter(arc => arc.share > 0).map(arc => <circle key={arc.label} cx="60" cy="60" r="46" fill="none" stroke={arc.color} strokeWidth={active === arc.label ? 17 : 14} pathLength="100"
          strokeDasharray={`${Math.max(0.1, arc.share - (visible > 1 ? 0.8 : 0))} ${100 - arc.share + (visible > 1 ? 0.8 : 0)}`} strokeDashoffset={-arc.offset}
          opacity={active && active !== arc.label ? 0.3 : 1} onPointerEnter={() => setActive(arc.label)} className="cursor-pointer transition-[opacity,stroke-width] duration-150" />)}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <strong className="text-[clamp(1rem,3vh,1.5rem)] font-semibold leading-tight tabular-nums text-slate-900">{focus ? `${number.format(focus.share)}%` : number.format(sum)}</strong>
        <span className="max-w-[70%] truncate text-[11px] text-slate-500">{focus ? focus.label : 'meter'}</span>
      </div>
    </div>
    <ul className="min-w-[8.5rem] flex-1 space-y-1">
      {arcs.map(arc => <li key={arc.label} tabIndex={0} onPointerEnter={() => setActive(arc.label)} onFocus={() => setActive(arc.label)} onBlur={() => setActive(null)}
        className={`flex cursor-default items-center gap-2 rounded-lg px-2 py-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${active === arc.label ? 'bg-slate-100' : ''}`}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: arc.color }} />
        <span className="truncate text-slate-600">{arc.label}</span>
        <strong className="ml-auto whitespace-nowrap tabular-nums text-slate-900">{number.format(arc.value)} m</strong>
      </li>)}
    </ul>
  </div>
}
export const Donut = memo(DonutBase)
