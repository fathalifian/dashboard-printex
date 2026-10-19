'use client'

import { useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { reloadMachines, useMachines } from '@/lib/machines-store'
import { MACHINE_KINDS, MACHINE_KIND_LABEL, canRemoveMachine, nextMachineName, type Machine, type MachineKind } from '@/lib/production-machines'
import { addMachine, removeMachine, renameMachine } from '@/app/(admin)/admin/_actions/machines'

export default function MachineSettings({ framed = true }: { framed?: boolean }) {
  const { profile } = useOnlineConnection()
  const canEdit = canManageOrders(profile?.role)
  const { machines, loaded, available } = useMachines()
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<Machine | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<{ ok: boolean; error: string }>) {
    if (busy) return false
    setBusy(true); setError('')
    try {
      const result = await action()
      if (!result.ok) { setError(result.error); return false }
      await reloadMachines()
      return true
    } catch { setError('Perubahan belum tersimpan. Periksa koneksi lalu coba lagi.'); return false }
    finally { setBusy(false) }
  }
  async function saveName(event: FormEvent) {
    event.preventDefault()
    if (editing && await run(() => renameMachine(editing.id, editing.name))) setEditing(null)
  }

  const body = !loaded ? <p role="status" className="text-sm text-slate-500">Memuat daftar mesin...</p>
    : !available ? <p className="text-sm text-slate-500">Daftar mesin belum tersedia. Jalankan supabase/SETUP.sql di Supabase.</p>
    : <div className="space-y-4">
      {MACHINE_KINDS.map((kind: MachineKind) => {
        const list = machines.filter(machine => machine.kind === kind)
        return <div key={kind}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{MACHINE_KIND_LABEL[kind]} · {list.length} mesin</h4>
            {canEdit && <button type="button" disabled={busy} onClick={() => void run(() => addMachine(kind, nextMachineName(machines, kind)))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-40"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Tambah</button>}
          </div>
          <ul className="space-y-1.5">
            {list.map(machine => <li key={machine.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              {editing?.id === machine.id ? <form onSubmit={saveName} className="flex flex-1 items-center gap-2">
                <input autoFocus required maxLength={40} aria-label={`Nama baru ${machine.name}`} value={editing.name} onChange={event => setEditing({ id: machine.id, name: event.target.value })} disabled={busy} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm" />
                <button type="submit" disabled={busy} aria-label="Simpan nama mesin" className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                <button type="button" disabled={busy} onClick={() => setEditing(null)} aria-label="Batal mengganti nama" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </form> : <>
                <span className="flex-1 text-sm font-medium text-slate-800">{machine.name}</span>
                {canEdit && <button type="button" disabled={busy} onClick={() => { setEditing({ id: machine.id, name: machine.name }); setRemoving(null) }} aria-label={`Ganti nama ${machine.name}`} className="rounded-md p-1.5 text-slate-500 hover:bg-white"><Pencil className="h-3.5 w-3.5" /></button>}
                {canEdit && canRemoveMachine(machines, machine) && <button type="button" disabled={busy} onClick={() => { setRemoving(machine); setEditing(null) }} aria-label={`Hapus ${machine.name}`} className="rounded-md p-1.5 text-red-600 hover:bg-white"><Trash2 className="h-3.5 w-3.5" /></button>}
              </>}
            </li>)}
            {!list.length && <li className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Belum ada mesin.</li>}
          </ul>
        </div>
      })}
      {removing && <div role="alertdialog" aria-labelledby="remove-machine-title" className="rounded-xl border border-red-200 bg-red-50 p-3">
        <p id="remove-machine-title" className="text-sm font-semibold text-red-700">Hapus {removing.name}?</p>
        <p className="mt-1 text-xs leading-5 text-red-700/80">Mesin tidak dapat dipilih lagi. Riwayat order yang sudah dicetak di mesin ini tetap tersimpan.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setRemoving(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">Batal</button>
          <button type="button" disabled={busy} onClick={async () => { if (await run(() => removeMachine(removing.id))) setRemoving(null) }} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Hapus mesin</button>
        </div>
      </div>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!canEdit && <p className="text-xs text-slate-500">Hanya Admin dan Owner yang dapat mengubah daftar mesin.</p>}
    </div>

  if (!framed) return body
  return <section aria-labelledby="machine-settings-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 id="machine-settings-title" className="mb-1 text-sm font-semibold text-slate-900">Mesin produksi</h3>
    <p className="mb-4 text-xs leading-5 text-slate-500">Order DTF dicetak di mesin DTF; bahan lain di mesin Fedar. Jumlah mesin dipakai untuk kapasitas harian.</p>
    {body}
  </section>
}
