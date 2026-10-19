'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseMachineRow, type Machine } from '@/lib/production-machines'

type MachineState = { machines: Machine[]; loaded: boolean; available: boolean }
let state: MachineState = { machines: [], loaded: false, available: false }
const listeners = new Set<() => void>()
let request: Promise<void> | undefined

async function load() {
  request ??= (async () => {
    // Removed machines stay in the table for archived orders but are hidden here.
    const { data, error } = await createClient().from('production_machines').select('id,kind,name,created_at')
      .is('removed_at', null).order('created_at').order('name')
    state = error ? { machines: [], loaded: true, available: false }
      : { machines: (data ?? []).map(row => parseMachineRow(row)).filter((row): row is Machine => !!row), loaded: true, available: true }
  })().finally(() => { request = undefined; listeners.forEach(listener => listener()) })
  return request
}

/** Reloads the machine list, e.g. after a machine is added, renamed or removed. */
export async function reloadMachines() { await load() }

/** Active machines (Pusat Admin → Mesin), refreshed every minute and on focus. */
export function useMachines(enabled = true) {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state, () => state)
  useEffect(() => {
    if (!enabled) return
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [enabled])
  return value
}
