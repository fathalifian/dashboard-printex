'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { normalizeRole, ROLE_LABELS } from '@/lib/access-control'
import { updateManagedUser } from './actions'

export default function ManagedUserEditor({ account, branches, central, onClose, onSaved }: {
  account: { id: string; full_name: string; email: string; role: string; is_active: boolean; branch_id?: string }
  branches?: { id: string; name: string }[]
  central?: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ fullName: account.full_name, role: normalizeRole(account.role) ?? 'operator', active: account.is_active, branchId: account.branch_id ?? '' })
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { if (!submitting.current) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setMessage('')
    try {
      const result = await updateManagedUser(account.id, { ...form, branchId: form.role === 'central_owner' ? undefined : form.branchId || undefined })
      if (result.error) { setMessage(result.error); return }
      await onSaved()
    } catch { setMessage('Permintaan gagal. Periksa koneksi dan coba lagi.') }
    finally { submitting.current = false; setBusy(false) }
  }
  const input = 'mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900'
  return <dialog ref={dialog} aria-labelledby="managed-user-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/50">
    <h2 id="managed-user-title" className="font-semibold text-slate-900">Edit Pengguna</h2>
    <p className="mt-1 break-words text-sm text-slate-500">{account.email}</p>
    <form onSubmit={submit} className="mt-5">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm text-slate-700">Nama<input autoFocus required maxLength={100} className={input} value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })}/></label>
        <label className="block text-sm text-slate-700">Role<select className={input} value={form.role} onChange={event => setForm({ ...form, role: normalizeRole(event.target.value) ?? 'operator' })}>{Object.entries(ROLE_LABELS).filter(([role]) => branches && !central ? ['admin', 'operator'].includes(role) : role !== 'central_owner' || central).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
        {branches && form.role !== 'central_owner' && <label className="block text-sm text-slate-700">Cabang<select required className={input} value={form.branchId} onChange={event => setForm({ ...form, branchId: event.target.value })}><option value="">Pilih cabang</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })}/>Akun aktif</label>
        {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end gap-4 pt-2"><button type="button" onClick={close} className="text-sm text-slate-600">Batal</button><button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Menyimpan...' : 'Simpan Perubahan'}</button></div>
      </fieldset>
    </form>
  </dialog>
}
