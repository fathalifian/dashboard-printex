'use server'

import { authorizeSettings } from '@/lib/settings-auth'
import { MACHINE_KINDS, MACHINE_KIND_LABEL, canRemoveMachine, parseMachineRow, validateMachineName, type Machine, type MachineKind } from '@/lib/production-machines'

async function activeMachines() {
  const { client } = await authorizeSettings(true)
  const { data, error } = await client.from('production_machines').select('id,kind,name').is('removed_at', null)
  if (error) throw new Error('Daftar mesin belum tersedia. Jalankan supabase/SETUP.sql di Supabase.')
  return { client, machines: (data ?? []).map(row => parseMachineRow(row)).filter((row): row is Machine => !!row) }
}
const failure = (error: unknown, fallback: string) => ({ ok: false as const, error: error instanceof Error ? error.message : fallback })
const duplicate = (message: string | undefined) => message?.includes('production_machines_active_name') ? 'Nama mesin sudah dipakai.' : null

export async function addMachine(kind: MachineKind, name: string) {
  try {
    if (!MACHINE_KINDS.includes(kind)) throw new Error('Jenis mesin tidak valid.')
    const { client, machines } = await activeMachines()
    if (machines.filter(machine => machine.kind === kind).length >= 20) throw new Error(`Maksimal 20 mesin ${MACHINE_KIND_LABEL[kind]}.`)
    const { error } = await client.from('production_machines').insert({ kind, name: validateMachineName(name, machines) })
    if (error) throw new Error(duplicate(error.message) ?? 'Mesin belum tersimpan. Periksa koneksi lalu coba lagi.')
    return { ok: true as const, error: '' }
  } catch (error) { return failure(error, 'Mesin belum tersimpan.') }
}

export async function renameMachine(id: string, name: string) {
  try {
    const { client, machines } = await activeMachines()
    if (!machines.some(machine => machine.id === id)) throw new Error('Mesin tidak ditemukan. Muat ulang halaman.')
    const { data, error } = await client.from('production_machines').update({ name: validateMachineName(name, machines, id) })
      .eq('id', id).is('removed_at', null).select('id').maybeSingle()
    if (error) throw new Error(duplicate(error.message) ?? 'Nama mesin belum tersimpan.')
    if (!data) throw new Error('Mesin tidak ditemukan. Muat ulang halaman.')
    return { ok: true as const, error: '' }
  } catch (error) { return failure(error, 'Nama mesin belum tersimpan.') }
}

export async function removeMachine(id: string) {
  try {
    const { client, machines } = await activeMachines()
    const machine = machines.find(item => item.id === id)
    if (!machine) throw new Error('Mesin tidak ditemukan. Muat ulang halaman.')
    if (!canRemoveMachine(machines, machine)) throw new Error(`Minimal satu mesin ${MACHINE_KIND_LABEL[machine.kind]} harus tersedia agar order dapat masuk Proses Sublim.`)
    // Soft removal: archived orders keep their machine; it no longer appears for selection.
    const { error } = await client.from('production_machines').update({ removed_at: new Date().toISOString() }).eq('id', id).is('removed_at', null)
    if (error) throw new Error('Mesin belum dihapus. Periksa koneksi lalu coba lagi.')
    return { ok: true as const, error: '' }
  } catch (error) { return failure(error, 'Mesin belum dihapus.') }
}
