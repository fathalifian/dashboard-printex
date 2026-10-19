'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { jakartaDate } from '@/lib/process-metrics'
import { shiftDate } from '@/lib/pending-orders'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_CREW, parseCapacityRow, type Crew } from '@/lib/production-capacity'
import { SHIFT_STAGES, setOperatorShift, useOperatorShifts, type ShiftStage } from '@/lib/production-records'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const STAGES = Object.keys(SHIFT_STAGES) as ShiftStage[]
const dayLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const text = (value: number) => String(value).replace('.', ',')
const decimal = (value: string) => Number(value.replace(',', '.'))
type Draft = Record<ShiftStage, { people: string; hours: string }>
type Standard = { crew: Crew; hours: number }

// The standard crew and effective hours (Pusat Admin → Waktu kerja).
function useStandard() {
  const [standard, setStandard] = useState<Standard | null>(null)
  useEffect(() => {
    let cancelled = false
    void createClient().from('production_settings').select('*').maybeSingle().then(({ data }) => {
      if (cancelled) return
      try {
        const settings = data ? parseCapacityRow(data) : null
        setStandard({ crew: settings?.crew ?? DEFAULT_CREW, hours: settings?.effective_hours ?? 7 })
      } catch { setStandard({ crew: DEFAULT_CREW, hours: 7 }) }
    })
    return () => { cancelled = true }
  }, [])
  return standard
}

/** Operators per stage for one day. Every day starts from the standard; only differences are stored. */
export default function OperatorShiftSettings() {
  const today = jakartaDate(new Date())
  const [date, setDate] = useState(today)
  const shifts = useOperatorShifts(shiftDate(today, -13), today)
  const standard = useStandard()
  const [draft, setDraft] = useState<{ date: string; values: Draft } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const saved = (day: string, stage: ShiftStage) => shifts.rows.find(row => row.date === day && row.stage === stage)
  // The numbers in effect for a day: its override, otherwise the standard.
  const effective = (day: string, stage: ShiftStage) => {
    const row = saved(day, stage)
    return row ? { people: row.people, hours: row.hours, changed: true } : { people: standard?.crew[stage] ?? 1, hours: standard?.hours ?? 7, changed: false }
  }
  const values: Draft = draft?.date === date ? draft.values : Object.fromEntries(STAGES.map(stage => {
    const current = effective(date, stage)
    return [stage, { people: String(current.people), hours: text(current.hours) }]
  })) as Draft
  const change = (stage: ShiftStage, key: 'people' | 'hours', value: string) => { setDraft({ date, values: { ...values, [stage]: { ...values[stage], [key]: value } } }); setMessage(null) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!standard || busy) return
    setBusy(true); setMessage(null)
    try {
      for (const stage of STAGES) {
        const people = Number(values[stage].people.trim() || 0), hours = decimal(values[stage].hours)
        if (!Number.isInteger(people) || people < 0 || people > 50) throw new Error(`Jumlah operator ${SHIFT_STAGES[stage]} 0 sampai 50.`)
        if (people && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) throw new Error(`Jam kerja ${SHIFT_STAGES[stage]} lebih dari 0 dan maksimal 24.`)
        // Same as the standard: store nothing, so later changes to the standard still apply.
        const isStandard = people === standard.crew[stage] && (people === 0 || hours === standard.hours)
        const row = saved(date, stage)
        if (isStandard ? !row : row?.people === people && (people === 0 || row.hours === hours)) continue
        await setOperatorShift(date, stage, isStandard ? null : people, people ? hours : 1)
      }
      setDraft(null); shifts.reload()
      setMessage({ error: false, text: 'Jam operator tersimpan.' })
    } catch (reason) { setMessage({ error: true, text: reason instanceof Error ? reason.message : 'Jam operator belum tersimpan.' }) }
    finally { setBusy(false) }
  }

  if (shifts.loaded && !shifts.available) return <p className="text-sm text-slate-500">Jam operator belum tersedia. Jalankan supabase/SETUP.sql di Supabase.</p>
  if (!standard || !shifts.loaded) return <p role="status" className="text-sm text-slate-500">Memuat jam operator...</p>
  const days = Array.from({ length: 14 }, (_, index) => shiftDate(today, -index))
  return <div className="space-y-6">
    <form onSubmit={submit} className="space-y-3">
      <label className="flex items-center gap-3 text-sm font-medium text-slate-700">Tanggal
        <input type="date" required value={date} max={today} onChange={event => { setDate(event.target.value); setMessage(null) }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </label>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th scope="col" className="px-3 py-2 text-left font-semibold">Tahap</th><th scope="col" className="px-3 py-2 text-left font-semibold">Operator (orang)</th><th scope="col" className="px-3 py-2 text-left font-semibold">Jam per orang</th><th scope="col" className="px-3 py-2 text-right font-semibold">Jam-orang</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{STAGES.map(stage => {
            const people = Number(values[stage].people || 0), hours = decimal(values[stage].hours)
            const changed = people !== standard.crew[stage] || (people > 0 && hours !== standard.hours)
            return <tr key={stage}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-slate-800">{SHIFT_STAGES[stage]}{changed && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">diubah</span>}</th>
              <td className="px-3 py-2"><input inputMode="numeric" aria-label={`Jumlah operator ${SHIFT_STAGES[stage]}`} value={values[stage].people} onChange={event => change(stage, 'people', event.target.value)} disabled={busy} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 tabular-nums" /></td>
              <td className="px-3 py-2"><input inputMode="decimal" aria-label={`Jam kerja ${SHIFT_STAGES[stage]}`} value={values[stage].hours} onChange={event => change(stage, 'hours', event.target.value)} disabled={busy || people === 0} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 tabular-nums" /></td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-700">{people > 0 && Number.isFinite(hours) ? number.format(people * hours) : 0} jam</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Standar: {STAGES.map(stage => `${SHIFT_STAGES[stage]} ${standard.crew[stage]}`).join(' · ')} orang × {text(standard.hours)} jam (Pusat Admin → Waktu kerja). Ubah angka hanya bila hari itu berbeda.</p>
      {message && <p role={message.error ? 'alert' : 'status'} className={'text-sm ' + (message.error ? 'text-red-600' : 'text-emerald-700')}>{message.text}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Menyimpan...' : 'Simpan'}</button>
    </form>
    <section aria-labelledby="shift-history-title">
      <h3 id="shift-history-title" className="mb-2 text-sm font-semibold text-slate-900">14 hari terakhir <span className="font-normal text-slate-500">· operator × jam</span></h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="px-3 py-2 text-left font-semibold">Tanggal</th>{STAGES.map(stage => <th key={stage} scope="col" className="px-3 py-2 text-right font-semibold">{SHIFT_STAGES[stage]}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{days.map(day => <tr key={day} onClick={() => setDate(day)} className={`cursor-pointer hover:bg-slate-50 ${day === date ? 'bg-brand-50/50' : ''}`}>
            <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">{dayLabel.format(new Date(day + 'T12:00:00Z'))}</th>
            {STAGES.map(stage => {
              const current = effective(day, stage)
              return <td key={stage} className={`px-3 py-2 text-right ${current.changed ? 'font-semibold text-amber-700' : 'text-slate-600'}`} title={current.changed ? 'Diubah untuk hari ini' : 'Sesuai standar'}>{current.people} × {number.format(current.hours)} jam</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </div>
}
