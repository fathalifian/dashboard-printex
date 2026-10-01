'use client'

import { memo, useMemo, useState } from 'react'
import { Clock3, Gauge, Layers3, Printer } from 'lucide-react'
import { formatDuration } from '@/lib/process-timing'
import type { ProcessEvent } from '@/lib/process-metrics'
import { productivityRows, summarizeProductivity, type ProductivityOrder, type ProductivityPaperWidth } from '@/lib/productivity'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
const processes = [
  { key: 'sublim', label: 'Print Sublim', icon: Printer, color: 'bg-sky-50 text-sky-700' },
  { key: 'dtf', label: 'Print DTF', icon: Printer, color: 'bg-violet-50 text-violet-700' },
  { key: 'press', label: 'Press', icon: Layers3, color: 'bg-amber-50 text-amber-700' },
] as const
const display = (value: number | null) => value === null ? '—' : number.format(value)
const formatDate = (value: string) => date.format(new Date(`${value}T12:00:00+07:00`))

function ProductivityReport({ orders, history, start, end, scope }: {
  orders: ProductivityOrder[]; history: ProcessEvent[]; start: string; end: string; scope: string
}) {
  const [paperWidth, setPaperWidth] = useState<ProductivityPaperWidth>('all')
  const rows = useMemo(() => productivityRows(orders, history, start, end, paperWidth), [orders, history, start, end, paperWidth])
  const validRange = Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && start <= end

  return <section aria-labelledby="productivity-title" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Gauge aria-hidden="true" className="h-5 w-5" /></span>
        <div>
          <h2 id="productivity-title" className="text-lg font-semibold text-slate-900">Produktivitas produksi</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{scope} · {validRange ? start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}` : 'Pilih periode yang valid'}</p>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-600">Lebar kertas
        <select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:outline-2 focus:outline-offset-2 focus:outline-brand-600" value={paperWidth} onChange={event => setPaperWidth(event.target.value as ProductivityPaperWidth)}>
          <option value="all">Semua lebar</option>
          {(['1.2', '1.6', '1.8'] as const).map(width => <option key={width} value={width}>{width.replace('.', ',')} m</option>)}
        </select>
      </label>
    </header>
    <div className="p-5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {processes.map(({ key, label, icon: Icon, color }) => {
          const summary = summarizeProductivity(rows[key])
          return <article key={key} aria-labelledby={`productivity-${key}`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="h-5 w-5" /></span><div><h3 id={`productivity-${key}`} className="text-base font-semibold text-slate-900">{label}</h3></div></div>
            </div>
            {summary.orderCount ? <>
              <div className="mt-5 rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-700">Hasil per jam</p>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><strong className="break-all text-4xl font-semibold tracking-tight tabular-nums text-slate-900">{display(summary.productivity)}</strong><span className="text-sm text-slate-600">meter / jam</span></p>
              </div>
              <dl>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-4">
                  <dt className="flex items-center gap-2 text-sm text-slate-600"><Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />Waktu untuk 1 meter</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatDuration(summary.cycleTimeSecondsPerMeter === null ? null : summary.cycleTimeSecondsPerMeter * 1000)}</dd>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 py-5">
                  <div><dt className="text-sm text-slate-600">Total hasil</dt><dd className="mt-1.5 break-words text-lg font-semibold tabular-nums text-slate-900">{display(summary.totalMeter)} <span className="text-xs font-normal text-slate-500">meter</span></dd></div>
                  <div><dt className="text-sm text-slate-600">SPK selesai diproses</dt><dd className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900">{number.format(summary.orderCount)} <span className="text-xs font-normal text-slate-500">SPK</span></dd></div>
                  <div><dt className="text-sm text-slate-600">Total waktu proses</dt><dd className="mt-1.5 break-words text-sm font-semibold tabular-nums text-slate-900">{display(summary.hours)} <span className="font-normal text-slate-500">jam</span></dd></div>
                  <div><dt className="text-sm text-slate-600">Rata-rata waktu / SPK</dt><dd className="mt-1.5 text-sm font-semibold tabular-nums text-slate-900">{formatDuration(summary.averageDurationMilliseconds)}</dd></div>
                </div>
              </dl>
              {summary.productivity === null && <p className="mt-3 text-xs text-slate-500">Data belum lengkap.</p>}
            </> : <div className="flex min-h-28 flex-col items-center justify-center px-3 text-center"><Gauge aria-hidden="true" className="mb-3 h-7 w-7 text-slate-300" /><p className="text-sm font-medium text-slate-700">Belum ada data</p></div>}
          </article>
        })}
      </div>
    </div>
  </section>
}

export default memo(ProductivityReport)
