'use client'

import { memo, useMemo } from 'react'
import OutputTrend from '@/components/dashboard/output-trend'
import { paperOutput, paperLabel, PAPER_WIDTHS } from '@/lib/paper-output'
import type { BoardOrder } from '@/lib/production-board'
import type { ProcessEvent } from '@/lib/process-metrics'

const number = new Intl.NumberFormat('id-ID', {maximumFractionDigits:2})
const colors = { '0.6':'bg-violet-500', '1.2':'bg-sky-500', '1.6':'bg-emerald-500', '1.8':'bg-rose-500' }
const strokes = { '0.6':'#8b5cf6', '1.2':'#0ea5e9', '1.6':'#10b981', '1.8':'#f43f5e' }
function PaperOutput({orders,history,start,end,scope,trendOnly=false,sharedGrid=false}: {trendOnly?:boolean;sharedGrid?:boolean;orders:BoardOrder[];history:ProcessEvent[];start:string;end:string;scope:string}) {
  const data=useMemo(()=>paperOutput(orders,history,start,end),[orders,history,start,end])
  const total=PAPER_WIDTHS.reduce((sum,width)=>sum+data.totals[width].meter,0)
  const segments=PAPER_WIDTHS.map((width,index)=>({width,
    share:total?data.totals[width].meter/total*100:0,
    offset:total?PAPER_WIDTHS.slice(0,index).reduce((sum,key)=>sum+data.totals[key].meter,0)/total*100:0,
  }))
  return <div className={sharedGrid?"contents":trendOnly?"min-w-0":"grid min-w-0 gap-5 xl:grid-cols-3"}>
    <section className={"min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm " + (sharedGrid?"xl:col-start-3 xl:row-start-1":"xl:col-span-2")}>
      <OutputTrend title={trendOnly ? scope : 'Tren output kertas'} scope={scope}
        series={PAPER_WIDTHS.map(width => ({ label: paperLabel(width), color: strokes[width] }))}
        days={data.trend.map(day => ({ day: day.day, values: PAPER_WIDTHS.map(width => day.values[width].meter) }))}
        empty={!total} />
    </section>
    {!trendOnly && <section className={"min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" + (sharedGrid?" xl:col-start-4 xl:row-start-1":"")}>
      <h3 className="font-semibold text-slate-900">Komposisi output kertas</h3>
      <div className="relative mx-auto my-6 h-44 w-44">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={total?segments.map(({width,share})=>`Kertas ${paperLabel(width)}: ${number.format(share)} persen`).join(', '):'Belum ada output kertas tercatat'}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--line)" strokeWidth="14" />
          {segments.filter(segment=>segment.share>0).map(({width,share,offset})=><circle key={width} cx="60" cy="60" r="48" fill="none" stroke={strokes[width]} strokeWidth="14" pathLength="100" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={-offset} />)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-slate-500">Total output</span><strong className="mt-1 max-w-32 break-all text-center text-2xl tabular-nums text-slate-900">{number.format(total)}</strong><span className="text-xs text-slate-500">meter</span></div>
      </div>
      <div className="space-y-3">{segments.map(({width,share})=><div key={width} className="flex flex-wrap items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-sm ${colors[width]}`} /><span className="text-slate-600">{paperLabel(width)}</span><strong className="ml-auto tabular-nums text-slate-900">{number.format(data.totals[width].meter)} m</strong><span className="w-16 text-right text-xs text-slate-500">{total?number.format(share)+'%':'—'}</span></div>)}</div>
      {data.totals.unknown.count>0 && <p className="mt-4 text-xs leading-5 text-slate-500">Di luar total: {number.format(data.totals.unknown.meter)} m ? {data.totals.unknown.count} order tanpa lebar kertas.</p>}
    </section>}
  </div>
}

export default memo(PaperOutput)
