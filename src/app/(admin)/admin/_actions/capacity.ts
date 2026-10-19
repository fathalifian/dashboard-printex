'use server'

import { authorizeSettings } from '@/lib/settings-auth'
import { parseCapacityRow, validateCapacitySettings, type CapacitySettings } from '@/lib/production-capacity'

const sameValues = (a: CapacitySettings, b: CapacitySettings) =>
  a.effective_hours === b.effective_hours && a.shifts === b.shifts && a.shift_hours === b.shift_hours
  && a.planned_downtime_minutes === b.planned_downtime_minutes && (a.design_orders_per_hour ?? null) === (b.design_orders_per_hour ?? null)
  && JSON.stringify(a.crew ?? null) === JSON.stringify(b.crew ?? null)

/** Saves working time and the standard crew; the database derives effective hours. */
export async function saveCapacitySettings(input: CapacitySettings) {
  try {
    const { client } = await authorizeSettings(true)
    const settings = validateCapacitySettings(input)
    const values = { shifts: settings.shifts, shift_hours: settings.shift_hours, planned_downtime_minutes: settings.planned_downtime_minutes, design_orders_per_hour: settings.design_orders_per_hour ?? null,
      operators_printing: settings.crew?.printing, operators_dtf: settings.crew?.dtf, operators_press: settings.crew?.press, operators_design: settings.crew?.design }
    const { data, error } = await client.from('production_settings')
      .update({ ...values, version: settings.version + 1 })
      .eq('singleton', true).eq('version', settings.version)
      .select('*').maybeSingle()
    if (error) throw new Error(error.message.includes('Istirahat') || error.message.includes('24 jam') ? error.message : 'Pengaturan kapasitas belum tersimpan. Periksa koneksi lalu coba lagi.')
    if (data) return { settings: parseCapacityRow(data), error: '' }
    const current = await client.from('production_settings').select('*').maybeSingle()
    if (current.error || !current.data) throw new Error('Pengaturan kapasitas belum tersedia. Muat ulang dan coba lagi.')
    const latest = parseCapacityRow(current.data)
    // A retry after a lost response can safely acknowledge the same saved values.
    if (sameValues(latest, { ...settings, version: latest.version })) return { settings: latest, error: '' }
    return { settings: null, latest, error: 'Pengaturan telah diubah pengguna lain. Muat data terbaru sebelum menyimpan.' }
  } catch (error) {
    return { settings: null, error: error instanceof Error ? error.message : 'Pengaturan kapasitas belum tersimpan.' }
  }
}
