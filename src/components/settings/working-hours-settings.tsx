'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { createClient } from '@/lib/supabase/client'
import { CREW_STAGES, DEFAULT_CREW, parseCapacityRow, validateCapacitySettings, type CapacitySettings, type CrewStage } from '@/lib/production-capacity'
import { saveCapacitySettings } from '@/app/(admin)/admin/_actions/capacity'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const field = 'w-24 rounded-lg border border-slate-200 px-3 py-2 tabular-nums'
const CREW_LABEL: Record<CrewStage, string> = { printing: 'Fedar', dtf: 'DTF', press: 'Press', design: 'Desain' }
type Draft = { shifts: string; shiftHours: string; downtime: string; design: string; crew: Record<CrewStage, string> }
const draftOf = (settings: CapacitySettings): Draft => ({
  shifts: String(settings.shifts ?? 1), shiftHours: String(settings.shift_hours ?? '').replace('.', ','), downtime: String(settings.planned_downtime_minutes ?? 0),
  design: settings.design_orders_per_hour ? String(settings.design_orders_per_hour).replace('.', ',') : '',
  crew: Object.fromEntries(CREW_STAGES.map(stage => [stage, String((settings.crew ?? DEFAULT_CREW)[stage])])) as Record<CrewStage, string>,
})

/** Working time: available hours, planned downtime, effective hours (T), standard crew and design speed. */
export default function WorkingHoursSettings({ onSaved }: { onSaved?: () => void }) {
  const { profile } = useOnlineConnection()
  const canEdit = canManageOrders(profile?.role)
  const [state, setState] = useState<{ settings: CapacitySettings | null; error: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void createClient().from('production_settings').select('*').maybeSingle().then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) { setState({ settings: null, error: 'Waktu kerja belum tersedia. Jalankan supabase/SETUP.sql di Supabase.' }); return }
      try { setState({ settings: parseCapacityRow(data), error: '' }) } catch { setState({ settings: null, error: 'Data waktu kerja tidak valid. Muat ulang halaman.' }) }
    })
    return () => { cancelled = true }
  }, [])
  const current = state
  const settings = current?.settings ?? null
  const values = draft ?? (settings ? draftOf(settings) : null)
  // Live preview with the same validation the server applies.
  let preview: CapacitySettings | null = null, invalid = ''
  if (settings && values) {
    try {
      preview = validateCapacitySettings({ ...settings, shifts: Number(values.shifts), shift_hours: Number(values.shiftHours.replace(',', '.')), planned_downtime_minutes: Number(values.downtime),
        design_orders_per_hour: values.design.trim() ? Number(values.design.replace(',', '.')) : null,
        crew: Object.fromEntries(CREW_STAGES.map(stage => [stage, Number(values.crew[stage] || 0)])) as CapacitySettings['crew'] })
    } catch (error) { invalid = error instanceof Error ? error.message : 'Isian tidak valid.' }
  }
  const change = (key: Exclude<keyof Draft, 'crew'>, value: string) => { setDraft({ ...values!, [key]: value }); setMessage(null) }
  const changeCrew = (stage: CrewStage, value: string) => { setDraft({ ...values!, crew: { ...values!.crew, [stage]: value } }); setMessage(null) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!preview || saving) return
    setSaving(true); setMessage(null)
    try {
      const result = await saveCapacitySettings(preview)
      if (!result.settings) {
        setMessage({ error: true, text: result.error })
        if (result.latest) { setState({ settings: result.latest, error: '' }); setDraft(null) }
        return
      }
      setState({ settings: result.settings, error: '' }); setDraft(null)
      setMessage({ error: false, text: 'Waktu kerja tersimpan.' }); onSaved?.()
    } catch (reason) { setMessage({ error: true, text: reason instanceof Error ? reason.message : 'Waktu kerja belum tersimpan. Periksa koneksi lalu coba lagi.' }) }
    finally { setSaving(false) }
  }

  if (!current) return <p role="status" className="text-sm text-slate-500">Memuat waktu kerja...</p>
  if (!settings || !values) return <p className="text-sm text-slate-500">{current.error}</p>
  const disabled = !canEdit || saving
  return <form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Jumlah shift per hari
        <select value={values.shifts} disabled={disabled} onChange={event => change('shifts', event.target.value)} className="mt-1.5 block w-24 rounded-lg border border-slate-200 px-3 py-2">{[1, 2, 3].map(count => <option key={count} value={count}>{count}</option>)}</select>
      </label>
      <label className="text-sm font-medium text-slate-700">Jam per shift
        <span className="mt-1.5 flex items-center gap-2"><input required inputMode="decimal" value={values.shiftHours} disabled={disabled} onChange={event => change('shiftHours', event.target.value)} className={field} /><span className="text-sm font-normal text-slate-500">jam</span></span>
      </label>
      <label className="text-sm font-medium text-slate-700">Istirahat &amp; setup per hari
        <span className="mt-1.5 flex items-center gap-2"><input required inputMode="numeric" value={values.downtime} disabled={disabled} onChange={event => change('downtime', event.target.value)} className={field} /><span className="text-sm font-normal text-slate-500">menit</span></span>
        <span className="mt-1 block text-xs font-normal text-slate-500">Istirahat, setup ganti kertas/kain, perawatan rutin terjadwal.</span>
      </label>
      <label className="text-sm font-medium text-slate-700">Kecepatan desain <span className="font-normal text-slate-500">(opsional)</span>
        <span className="mt-1.5 flex items-center gap-2"><input inputMode="decimal" value={values.design} disabled={disabled} onChange={event => change('design', event.target.value)} placeholder="Kosong" className={field} /><span className="text-sm font-normal text-slate-500">order/jam</span>{preview?.design_orders_per_hour ? <span className="text-sm font-normal tabular-nums text-slate-500">≈ {number.format(preview.design_orders_per_hour * preview.effective_hours)} order/hari</span> : null}</span>
        <span className="mt-1 block text-xs font-normal text-slate-500">Mengaktifkan &quot;Desain&quot; pada analisis bottleneck.</span>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-700">Operator standar per hari</legend>
        <div className="mt-1.5 flex flex-wrap gap-3">{CREW_STAGES.map(stage => <label key={stage} className="flex items-center gap-2 text-sm text-slate-600">{CREW_LABEL[stage]}
          <input inputMode="numeric" aria-label={`Operator ${CREW_LABEL[stage]}`} value={values.crew[stage]} disabled={disabled} onChange={event => changeCrew(stage, event.target.value)} className="w-16 rounded-lg border border-slate-200 px-2 py-2 tabular-nums" /></label>)}
          <span className="self-center text-sm text-slate-500">orang</span></div>
        <span className="mt-1 block text-xs text-slate-500">Jam kerja orang dihitung otomatis: operator × jam efektif, setiap hari ada produksi. Ubah hari tertentu di Jam operator.</span>
      </fieldset>
    </div>
    {preview && <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-slate-500">Jam tersedia</dt><dd className="font-semibold tabular-nums text-slate-900">{number.format(preview.available_hours ?? preview.effective_hours)} jam</dd></div>
      <div><dt className="text-xs text-slate-500">Jam efektif (T)</dt><dd className="font-semibold tabular-nums text-slate-900">{number.format(preview.effective_hours)} jam</dd></div>
      <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-slate-500">Dipakai untuk</dt><dd className="text-xs text-slate-700">Kapasitas dan produktivitas</dd></div>
    </dl>}
    {invalid && <p role="alert" className="text-sm text-red-600">{invalid}</p>}
    {message && <p role={message.error ? 'alert' : 'status'} className={'text-sm ' + (message.error ? 'text-red-600' : 'text-emerald-700')}>{message.text}</p>}
    {canEdit && <button type="submit" disabled={saving || !preview} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>}
  </form>
}
