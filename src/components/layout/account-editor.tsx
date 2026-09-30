'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { refreshOnlineData } from '@/lib/production-board'
import { roleLabel } from '@/lib/access-control'
import { updateOwnAccount } from './account-actions'

export default function AccountEditor({ profile, onClose }: {
  profile: { full_name: string; role: string }
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState(profile.full_name)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { if (!submitting.current) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setMessage('')
    try {
      const result = await updateOwnAccount({ fullName: name })
      if (result.error) { setMessage(result.error); return }
      await refreshOnlineData()
      setMessage('Akun berhasil diperbarui.')
    } catch { setMessage('Periksa koneksi dan muat ulang untuk melihat perubahan akun.') }
    finally { submitting.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} aria-labelledby="account-editor-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/50">
    <h2 id="account-editor-title" className="font-semibold text-slate-900">Edit Akun</h2>
    <p className="mt-1 text-sm text-slate-500">{roleLabel(profile.role)}</p>
    <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="block text-sm text-slate-700">Nama<input autoFocus required maxLength={100} autoComplete="name" disabled={busy} value={name} onChange={event => setName(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" /></label>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      <div className="flex justify-end gap-4">
        <button type="button" disabled={busy} onClick={close} className="text-sm text-slate-600">Tutup</button>
        <button type="submit" disabled={busy} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
      </div>
    </form>
  </dialog>
}
