'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, PackagePlus, PenTool, Wallet, Printer, Layers, PackageCheck, Handshake, Funnel } from 'lucide-react'
import { BOARD_STAGE_META, useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { productionFlow } from '@/lib/production-flow'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import { jakartaDate, type ProcessStage } from '@/lib/process-metrics'

const ICONS = [PackagePlus, PenTool, Wallet, Printer, Layers, PackageCheck, Handshake]
const COLORS = ['text-slate-600 bg-slate-100', 'text-rose-600 bg-rose-100', 'text-blue-600 bg-blue-100', 'text-amber-600 bg-amber-100', 'text-violet-600 bg-violet-100', 'text-emerald-600 bg-emerald-100', 'text-teal-600 bg-teal-100']
function duration(value: number | null) {
  if (value === null) return 'Belum tercatat'
  if (value < 60000) return '< 1 menit'
  const minutes = Math.floor(value / 60000)
  if (minutes < 60) return `${minutes} menit`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} jam ${minutes % 60} mnt`
  return `${Math.floor(minutes / 1440)} hari ${Math.floor(minutes % 1440 / 60)} jam`
}

export default function ProductionFlow({ selectedStage, onSelectStage }: { selectedStage: ProcessStage | 'all'; onSelectStage: (stage: ProcessStage | 'all') => void }) {
  const [range, setRange] = useState(todayRange)
  const orders = useAllOrders(), history = useProcessHistory(), connection = useOnlineConnection()
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 30000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [])
  const today = now ? jakartaDate(new Date(now)) : range.start
  const start = range.period === 'today' ? today : range.start
  const end = range.period === 'today' ? today : range.end
  const rows = useMemo(() => productionFlow(orders, history, now, { start, end }), [orders, history, now, start, end])
  return <section aria-labelledby="production-flow-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div className="flex items-center gap-3"><h2 id="production-flow-title" className="font-semibold text-slate-900">Alur Produksi</h2><button type="button" onClick={() => onSelectStage('all')} aria-pressed={selectedStage === 'all'} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${selectedStage === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>Semua tahap</button></div>
      <DateRangeFilter value={{ ...range, start, end }} onChange={setRange} />
    </div>
    {connection.state !== 'ready' || !now ? <p role="status" className="p-8 text-center text-sm text-slate-500">{connection.state === 'error' ? 'Ringkasan belum tersedia. Periksa koneksi data.' : 'Memuat alur produksi…'}</p> : <>
      <div className="rounded-b-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>Rata-rata waktu · WIB</span><div className="flex flex-wrap gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Potensi bottleneck</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Penumpukan order</span></div></div>
      <div className="overflow-x-auto p-1 pb-3" tabIndex={0} aria-label="Flowchart tujuh tahap produksi, geser untuk melihat semua tahap">
        <ol className="grid min-w-[1050px] grid-cols-7 gap-4">
          {rows.map((row, index) => {
            const Icon = ICONS[index]
            const waiting = row.waiting.length ? row.waiting.reduce((sum, value) => sum + value, 0) / row.waiting.length : null
            return <li key={row.stage} className="relative pt-2">
              {index < 6 && <ArrowRight aria-hidden="true" className="absolute -right-4 top-8 h-4 w-4 text-slate-400" strokeWidth={2.5} />}
              <button type="button" aria-label={`Tampilkan order ${BOARD_STAGE_META[row.stage].name}`} aria-pressed={selectedStage === row.stage} aria-controls="dashboard-orders" onClick={() => onSelectStage(row.stage)} className={`relative mx-auto mb-3 flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 ${selectedStage === row.stage ? 'ring-2 ring-blue-600 ring-offset-4' : ''}`}>
                
                <div className={`relative rounded-xl p-3 ${COLORS[index]}`}><Icon aria-hidden="true" className="h-7 w-7" strokeWidth={1.6} /></div>
                <span className="absolute -left-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-500">{index + 1}</span>
                {row.bottleneck && <span title="Potensi bottleneck" className="absolute -right-1 bottom-0 rounded-full bg-red-600 p-2 text-white shadow-sm"><Funnel aria-hidden="true" className="h-4 w-4" /></span>}
              </button>
              <div className={`min-h-[190px] rounded-xl border p-3 ${selectedStage === row.stage ? 'ring-2 ring-blue-600 ring-offset-2' : ''} ${row.bottleneck ? 'border-red-300 bg-red-50/70' : row.piling ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-white'}`}>
                <h3 className="min-h-10 text-center text-xs font-semibold leading-5 text-slate-800">{BOARD_STAGE_META[row.stage].name}</h3>
                <p className="mt-2 text-center text-2xl font-bold tabular-nums text-slate-900">{row.count}<span className="ml-1 text-xs font-normal text-slate-500">order</span></p>
                <dl aria-label="Rata-rata waktu" className="mt-3 space-y-2 border-t border-slate-200/70 pt-3 text-xs"><div><dt className="text-slate-500">Selesai pada periode</dt><dd title={`${row.samples} proses selesai pada periode ini (WIB)`} className="mt-0.5 font-semibold text-slate-800">{duration(row.average)}</dd></div><div><dt className="text-slate-500">Saat ini di board</dt><dd className="mt-0.5 font-medium text-slate-700">{duration(waiting)}</dd></div></dl>
                <div className="mt-3 space-y-1 text-[10px] font-semibold">
                  {row.bottleneck && <p title="Waktu order melebihi rata-rata historis; minimal 3 proses selesai." className="flex items-center gap-1 text-red-700"><Funnel className="h-3 w-3" />Potensi bottleneck</p>}
                  {row.piling && <p title="Minimal 2 order dan jumlahnya di atas rata-rata 5 tahap aktif." className="flex items-center gap-1 text-amber-700"><Layers className="h-3 w-3" />Order menumpuk</p>}
                </div>
              </div>
            </li>
          })}
        </ol>
      </div>
      </div>
    </>}
  </section>
}
