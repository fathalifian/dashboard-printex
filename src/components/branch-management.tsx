'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listBranches, saveBranch } from '@/app/(dashboard)/settings/branch-actions'
import { refreshOnlineData } from '@/lib/production-board'

export type ManagedBranch = { id: string; name: string; deleting?: boolean }
export type BranchChange = { action: 'create' | 'rename' | 'delete'; id?: string; name: string }

function BranchDialog({ change, onClose, onSave }: {
  change: BranchChange
  onClose: () => void
  onSave: (change: BranchChange) => Promise<{ error: string }>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState(change.name)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleting = change.action === 'delete'
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { if (!submitting.current) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || (deleting && confirmation !== change.name)) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await onSave({ ...change, name: deleting ? confirmation : name.trim() })
      if (result.error) setError(result.error)
      else onClose()
    } catch { setError('Permintaan gagal. Periksa koneksi dan coba lagi.') }
    finally { submitting.current = false; setBusy(false) }
  }
  const input = 'mt-2 block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900'
  return <dialog ref={dialog} aria-labelledby="branch-dialog-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/50">
    <h2 id="branch-dialog-title" className="font-semibold text-slate-900">{deleting ? 'Hapus Cabang' : change.action === 'create' ? 'Tambah Cabang' : 'Ubah Nama Cabang'}</h2>
    <form onSubmit={submit} className="mt-5">
      <fieldset disabled={busy} className="space-y-4">
        {deleting ? <>
          <p className="text-sm text-slate-700">Cabang <strong>{change.name}</strong> beserta akun cabang, order, riwayat, dan file di dalamnya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.</p>
          <label className="block text-sm text-slate-700">Ketik nama cabang untuk mengonfirmasi<input autoFocus required autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} className={input}/></label>
        </> : <label className="block text-sm text-slate-700">Nama cabang<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} className={input}/></label>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-4"><button type="button" onClick={close} className="text-sm text-slate-600">Batal</button><button type="submit" disabled={busy || (deleting ? confirmation !== change.name : !name.trim())} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Memproses...' : deleting ? 'Hapus Cabang dan Data' : 'Simpan'}</button></div>
      </fieldset>
    </form>
  </dialog>
}

export function BranchManagement({ branches, onSave }: {
  branches: ManagedBranch[]
  onSave: (change: BranchChange) => Promise<{ error: string }>
}) {
  const [change, setChange] = useState<BranchChange | null>(null)
  const [message, setMessage] = useState('')
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">Kelola Cabang</h2><button type="button" onClick={() => setChange({ action: 'create', id: crypto.randomUUID(), name: '' })} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Tambah Cabang</button></div>
    <p className="mt-3 text-sm text-slate-500">Buat cabang baru, ubah nama, atau hapus cabang beserta datanya.</p>
    {message && <p role="status" className="mt-4 text-sm text-slate-700">{message}</p>}
    <div className="mt-5 divide-y divide-slate-100">
      {branches.map(branch => <div key={branch.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><p className="min-w-0 break-words text-sm font-semibold text-slate-900">{branch.name}{branch.deleting && <span className="mt-1 block text-xs font-normal text-slate-500">Penghapusan belum selesai</span>}</p><div className="flex gap-4 text-sm">{!branch.deleting && <button type="button" onClick={() => setChange({ action: 'rename', ...branch })} className="text-brand-600">Ubah Nama</button>}<button type="button" onClick={() => setChange({ action: 'delete', ...branch })} className="text-red-600">{branch.deleting ? 'Lanjutkan Hapus' : 'Hapus'}</button></div></div>)}
      {!branches.length && <p className="py-6 text-center text-sm text-slate-500">Belum ada cabang.</p>}
    </div>
    {change && <BranchDialog change={change} onClose={() => setChange(null)} onSave={async value => {
      setMessage('')
      const result = await onSave(value)
      if (!result.error) setMessage(value.action === 'delete' ? 'Cabang beserta datanya berhasil dihapus.' : value.action === 'create' ? 'Cabang berhasil dibuat.' : 'Nama cabang berhasil diperbarui.')
      return result
    }}/>}
  </section>
}

export default function BranchManagementSettings() {
  const [branches, setBranches] = useState<ManagedBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function refresh() {
    const result = await listBranches()
    setError(result.error)
    if (!result.error) setBranches(result.branches)
    setLoading(false)
  }
  useEffect(() => {
    let cancelled = false
    void listBranches().then(result => {
      if (cancelled) return
      setBranches(result.branches); setError(result.error); setLoading(false)
    }).catch(() => { if (!cancelled) { setError('Daftar cabang belum dapat dimuat.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])
  if (loading || error) return <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-semibold text-slate-900">Kelola Cabang</h2><p role="status" className="mt-3 text-sm text-slate-600">{loading ? 'Memuat cabang...' : error}</p>{error && <button type="button" onClick={() => void refresh().catch(() => setError('Daftar cabang belum dapat dimuat.'))} className="mt-3 text-sm text-brand-600">Coba lagi</button>}</section>
  return <BranchManagement branches={branches} onSave={async change => {
    const result = await saveBranch(change)
    await refresh()
    await refreshOnlineData().catch(() => {})
    return result
  }}/>
}
