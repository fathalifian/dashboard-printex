'use client'

import { useMemo } from 'react'
import { paperOutput, paperLabel, PAPER_WIDTHS } from '@/lib/paper-output'
import type { BoardOrder } from '@/lib/production-board'
import type { ProcessEvent } from '@/lib/process-metrics'

const number = new Intl.NumberFormat('id-ID', {maximumFractionDigits:2})
const colors = { '0.6':'bg-violet-500', '1.2':'bg-sky-500', '1.6':'bg-emerald-500', '1.8':'bg-rose-500' }
const strokes = { '0.6':'#8b5cf6', '1.2':'#0ea5e9', '1.6':'#10b981', '1.8':'#f43f5e' }
const dateLabel = (day:string) => day.slice(8)+'/'+day.slice(5,7)+'/'+day.slice(0,4)
export default function PaperOutput({orders,history,start,end,scope,trendOnly=false}: {trendOnly?:boolean;orders:BoardOrder[];history:ProcessEvent[];start:string;end:string;scope:string}) {
  const data=useMemo(()=>paperOutput(orders,history,start,end),[orders,history,start,end])
  const scale=Math.max(1,...data.trend.flatMap(day=>PAPER_WIDTHS.map(width=>day.values[width].meter)))
  const ceiling=Math.ceil(scale/4)*4
  const total=PAPER_WIDTHS.reduce((sum,width)=>sum+data.totals[width].meter,0)
  const segments=PAPER_WIDTHS.map((width,index)=>({width,
    share:total?data.totals[width].meter/total*100:0,
    offset:total?PAPER_WIDTHS.slice(0,index).reduce((sum,key)=>sum+data.totals[key].meter,0)/total*100:0,
  }))
  return <div className={trendOnly?"min-w-0":"grid min-w-0 gap-5 xl:grid-cols-3"}>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold text-slate-900">{trendOnly?scope:'Tren output kertas'}</h3><p className="mt-1 text-xs text-slate-500">Output harian dalam meter ? {scope}</p></div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">{PAPER_WIDTHS.map(width=><span key={width} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-sm ${colors[width]}`} />{paperLabel(width)}</span>)}</div>
      </div>
    <div className="mt-6 flex gap-3">
      <div aria-hidden="true" className="mt-6 flex h-48 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-slate-500">{[4,3,2,1,0].map(tick=><span key={tick}>{number.format(ceiling*tick/4)}</span>)}</div>
    <div className="min-w-0 flex-1 overflow-x-auto pb-2 pt-6" tabIndex={0} aria-label="Grafik output kertas harian, geser untuk melihat rentang tanggal">
      <div className="grid gap-3" style={{gridTemplateColumns:`repeat(${Math.max(1,data.trend.length)},minmax(120px,1fr))`}} role="img" aria-label="Output harian untuk kertas 1,2, 1,6, dan 1,8 meter. Rincian tersedia di bawah.">
        {data.trend.map(day=><div key={day.day}>
          <div className="flex h-48 items-end justify-center gap-2 border-b border-slate-200 bg-[repeating-linear-gradient(to_top,transparent_0,transparent_calc(25%_-_1px),var(--line)_25%)]">
            {PAPER_WIDTHS.map(width=><div key={width} title={`${dateLabel(day.day)} / ${paperLabel(width)}: ${number.format(day.values[width].meter)} meter`} className={`relative w-7 rounded-t-sm ${colors[width]}`} style={{height:day.values[width].meter/ceiling*100+'%'}}><span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-slate-600">{number.format(day.values[width].meter)}</span></div>)}
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">{new Date(day.day+'T12:00:00Z').toLocaleDateString('id-ID',{day:'numeric',month:'short',timeZone:'UTC'})}</p>
        </div>)}
      </div>
    </div>
    </div>
    {PAPER_WIDTHS.every(width=>!data.totals[width].count) && <p className="mt-3 text-center text-xs text-slate-500">Belum ada output dengan lebar kertas tercatat pada periode ini.</p>}
    <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Lihat rincian angka harian</summary><div className="max-h-64 overflow-auto"><table className="mt-2 w-full min-w-[420px] text-left"><thead><tr><th scope="col" className="py-2">Tanggal</th>{PAPER_WIDTHS.map(width=><th scope="col" key={width}>Kertas {paperLabel(width)}</th>)}<th scope="col">Belum diisi</th></tr></thead><tbody>{data.trend.map(day=><tr key={day.day} className="border-t border-slate-100"><th scope="row" className="py-2 font-normal">{dateLabel(day.day)}</th>{[...PAPER_WIDTHS,'unknown' as const].map(width=><td key={width}>{number.format(day.values[width].meter)} m</td>)}</tr>)}</tbody></table></div></details>
    </section>
    {!trendOnly && <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900">Komposisi output kertas</h3>
      <p className="mt-1 text-xs text-slate-500">Porsi meter kertas DTF 0,6 m, 1,2 m, 1,6 m, dan 1,8 m</p>
      <div className="relative mx-auto my-6 h-44 w-44">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={total?segments.map(({width,share})=>`Kertas ${paperLabel(width)}: ${number.format(share)} persen`).join(', '):'Belum ada output kertas tercatat'}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--line)" strokeWidth="14" />
          {segments.filter(segment=>segment.share>0).map(({width,share,offset})=><circle key={width} cx="60" cy="60" r="48" fill="none" stroke={strokes[width]} strokeWidth="14" pathLength="100" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={-offset} />)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-slate-500">Total output</span><strong className="mt-1 max-w-32 break-all text-center text-2xl tabular-nums text-slate-900">{number.format(total)}</strong><span className="text-xs text-slate-500">meter</span></div>
      </div>
      <div className="space-y-3">{segments.map(({width,share})=><div key={width} className="flex flex-wrap items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-sm ${colors[width]}`} /><span className="text-slate-600">{paperLabel(width)}</span><strong className="ml-auto tabular-nums text-slate-900">{number.format(data.totals[width].meter)} m</strong><span className="w-16 text-right text-xs text-slate-500">{total?number.format(share)+'%':'—'}</span></div>)}</div>
      {data.totals.unknown.count>0 && <p className="mt-4 text-xs leading-5 text-slate-500">Lebar belum diisi: {number.format(data.totals.unknown.meter)} m dari {data.totals.unknown.count} order. Tidak termasuk total dan komposisi kertas.</p>}
    </section>}
  </div>
}
