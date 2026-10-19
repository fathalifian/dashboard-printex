'use client'

// Production records: machine runs (Mulai/Selesai cetak) and operator day overrides.
// Writes go through SECURITY DEFINER RPCs.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseEfficiencyInputs, type EfficiencyInputs } from '@/lib/production-metrics'

export const SHIFT_STAGES = { design: 'Desain', printing: 'Sublim (Fedar)', press: 'Press', dtf: 'DTF' } as const
export type ShiftStage = keyof typeof SHIFT_STAGES

const MISSING = 'Fitur ini memerlukan database terbaru. Jalankan supabase/SETUP.sql di Supabase.'
async function call<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await createClient().rpc(name, args)
  if (error) throw new Error(/function .* does not exist|Could not find the function/i.test(error.message) ? MISSING : error.message)
  return data as T
}

export const startRun = async (orderId: string) => { await call('printex_start_run', { p_order: orderId }); await reloadOpenRuns() }
export const finishRun = async (orderId: string) => { await call('printex_finish_run', { p_order: orderId }); await reloadOpenRuns() }
export const setOperatorShift = (date: string, stage: ShiftStage, people: number | null, hours: number) =>
  call('printex_set_operator_shift', { p_date: date, p_stage: stage, p_people: people, p_hours: hours })

// Open runs, shared by every card on the board (one request, not one per card).
type OpenRun = { orderId: string; startedAt: string; stage: string }
let openRuns: { loaded: boolean; runs: Map<string, OpenRun>; available: boolean } = { loaded: false, runs: new Map(), available: false }
const listeners = new Set<() => void>()
let request: Promise<void> | null = null
async function loadOpenRuns() {
  const { data, error } = await createClient().from('print_runs').select('order_id,started_at,stage').is('ended_at', null)
  openRuns = { loaded: true, available: !error, runs: new Map((data ?? []).map(row => [String(row.order_id), { orderId: String(row.order_id), startedAt: String(row.started_at), stage: String(row.stage) }])) }
  listeners.forEach(listener => listener())
}
export async function reloadOpenRuns() {
  if (!openRuns.loaded) return
  request ??= loadOpenRuns().finally(() => { request = null })
  await request
}
export function useOpenRuns(enabled: boolean) {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => openRuns, () => openRuns)
  useEffect(() => {
    if (!enabled) return
    void loadOpenRuns()
    const refresh = () => { if (document.visibilityState === 'visible') void loadOpenRuns() }
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [enabled])
  return enabled ? value : { loaded: false, runs: new Map<string, OpenRun>(), available: false }
}

/** Period totals for the dashboard (machine runs, man-hours); refreshed every minute. */
export function useEfficiencyInputs(start: string, end: string, enabled: boolean) {
  const key = enabled && start && end && start <= end ? `${start}|${end}` : ''
  const [state, setState] = useState<{ key: string; inputs: EfficiencyInputs | null; available: boolean }>({ key: '', inputs: null, available: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    const refresh = () => void createClient().rpc('printex_efficiency_inputs', { p_start: start, p_end: end }).then(({ data, error }) => {
      if (!cancelled) setState({ key, inputs: error ? null : parseEfficiencyInputs(data), available: !error })
    })
    refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [key, start, end, revision])
  const current = state.key === key ? state : { key, inputs: null, available: false }
  return { ...current, loaded: state.key === key, reload: () => setRevision(value => value + 1) }
}

export type ShiftRow = { date: string; stage: ShiftStage; people: number; hours: number }
/** Operator day overrides between two dates. */
export function useOperatorShifts(from: string, to: string) {
  const [state, setState] = useState<{ key: string; rows: ShiftRow[]; available: boolean }>({ key: '', rows: [], available: false })
  const [revision, setRevision] = useState(0)
  const key = `${from}|${to}`
  useEffect(() => {
    let cancelled = false
    void createClient().from('operator_shifts').select('work_date,stage,people,hours').gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).then(({ data, error }) => {
        if (!cancelled) setState({ key, available: !error, rows: (data ?? []).map(row => ({ date: String(row.work_date), stage: row.stage as ShiftStage, people: Number(row.people), hours: Number(row.hours) })) })
      })
    return () => { cancelled = true }
  }, [from, to, key, revision])
  const current = state.key === key ? state : { key, rows: [], available: false }
  return { ...current, loaded: state.key === key, reload: () => setRevision(value => value + 1) }
}
