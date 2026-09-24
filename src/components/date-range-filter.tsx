'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { jakartaDate } from '@/lib/process-metrics'

export type DateRange = { period: 'today'|'custom'; start:string; end:string }
export function todayRange():DateRange {
  const today=jakartaDate(new Date())
  return {period:'today',start:today,end:today}
}
function label(day:string){return new Date(`${day}T12:00:00Z`).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})}
export default function DateRangeFilter({value,onChange}:{value:DateRange;onChange:(range:DateRange)=>void}) {
  const [open,setOpen]=useState(false)
  const [month,setMonth]=useState(value.start.slice(0,7))
  const [first,setFirst]=useState<string|null>(null)
  const [hover,setHover]=useState<string|null>(null)
  const [error,setError]=useState('')
  const wrapper=useRef<HTMLDivElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!wrapper.current?.contains(event.target as Node)){setOpen(false);setFirst(null)}}
    document.addEventListener('pointerdown',outside)
    return ()=>document.removeEventListener('pointerdown',outside)
  },[open])
  function show(){setMonth(value.start.slice(0,7));setFirst(null);setHover(null);setError('');setOpen(true)}
  function preset(period:DateRange['period']) {
    if(period==='custom'){show();return}
    const range=todayRange()
    onChange({...range,period});setOpen(false);setFirst(null)
  }
  function select(day:string) {
    if(!first){setFirst(day);setHover(null);setError('');return}
    const [start,end]=[first,day].sort()
    if((Date.parse(end)-Date.parse(start))/86400000>92){setError('Pilih rentang maksimal 93 hari.');return}
    onChange({period:'custom',start,end});setOpen(false);setFirst(null);trigger.current?.focus()
  }
  function changeMonth(offset:number){const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+offset);setMonth(date.toISOString().slice(0,7))}
  const date=new Date(`${month}-01T12:00:00Z`)
  const offset=(date.getUTCDay()+6)%7
  const count=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()
  const [highlightStart,highlightEnd]=first?[first,hover??first].sort():[value.start,value.end]
  return <div ref={wrapper} className="relative flex max-w-full flex-wrap items-end gap-3" onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);setFirst(null);trigger.current?.focus()}}}>
    <label className="flex items-center gap-3 text-xs font-semibold text-slate-500">Periode<select value={open?'custom':value.period} onChange={e=>preset(e.target.value as DateRange['period'])} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700"><option value="today">Hari ini</option><option value="custom">Rentang tanggal</option></select></label>
    <button ref={trigger} type="button" onClick={()=>open?setOpen(false):show()} aria-expanded={open} aria-label="Pilih rentang tanggal" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700"><CalendarDays className="h-4 w-4 shrink-0"/>{label(value.start)}{value.start!==value.end?` – ${label(value.end)}`:''}</button>
    {open&&<div aria-label="Kalender rentang tanggal" className="date-filter-popover absolute right-0 top-full z-30 mt-2 w-[min(320px,calc(100vw-48px))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-1">
        <div className="flex shrink-0">
          <button type="button" aria-label="Tahun sebelumnya" title="Tahun sebelumnya" onClick={()=>changeMonth(-12)} className="h-8 w-7 rounded-md text-sm font-semibold text-brand-600 hover:bg-slate-100">{'<<'}</button>
          <button type="button" aria-label="Bulan sebelumnya" title="Bulan sebelumnya" onClick={()=>changeMonth(-1)} className="h-8 w-7 rounded-md text-sm font-semibold text-brand-600 hover:bg-slate-100">{'<'}</button>
        </div>
        <strong className="text-center text-sm text-slate-900">{date.toLocaleDateString('id-ID',{month:'long',year:'numeric',timeZone:'UTC'})}</strong>
        <div className="flex shrink-0">
          <button type="button" aria-label="Bulan berikutnya" title="Bulan berikutnya" onClick={()=>changeMonth(1)} className="h-8 w-7 rounded-md text-sm font-semibold text-brand-600 hover:bg-slate-100">{'>'}</button>
          <button type="button" aria-label="Tahun berikutnya" title="Tahun berikutnya" onClick={()=>changeMonth(12)} className="h-8 w-7 rounded-md text-sm font-semibold text-brand-600 hover:bg-slate-100">{'>>'}</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(day=><span key={day} className="py-1 text-center text-xs text-slate-500">{day}</span>)}
        {Array.from({length:offset},(_,i)=><span key={`blank-${i}`}/>)}
        {Array.from({length:count},(_,i)=>{
          const day=`${month}-${String(i+1).padStart(2,'0')}`
          const edge=day===highlightStart||day===highlightEnd
          const within=day>=highlightStart&&day<=highlightEnd
          return <button key={day} type="button" aria-label={label(day)} aria-pressed={within} onClick={()=>select(day)} onMouseEnter={()=>setHover(day)} onFocus={()=>setHover(day)} className={`h-9 rounded-lg text-sm focus-visible:outline-2 focus-visible:outline-brand-500 ${edge?'bg-brand-600 font-bold text-white':within?'bg-brand-50 font-medium text-brand-700':'text-slate-700 hover:bg-slate-100'}`}>{i+1}</button>
        })}
      </div>
      {error&&<p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex justify-between"><button type="button" onClick={()=>preset('today')} className="text-xs font-semibold text-brand-600">Hari ini</button><button type="button" onClick={()=>{setOpen(false);setFirst(null);trigger.current?.focus()}} className="text-xs text-slate-500">Batal</button></div>
    </div>}
  </div>
}
