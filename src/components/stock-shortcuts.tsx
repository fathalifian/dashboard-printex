'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Pencil, Sheet, X } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { DEFAULT_STOCK_SHORTCUTS, type StockShortcut } from '@/lib/stock-shortcuts'
import { getStockShortcuts, saveStockShortcut } from '@/app/(dashboard)/schedule/shortcut-actions'

function ShortcutEditor({ shortcut, onClose, onSaved }: { shortcut: StockShortcut; onClose: () => void; onSaved: (shortcut: StockShortcut) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [label, setLabel] = useState(shortcut.label)
  const [url, setUrl] = useState(shortcut.url)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { if (!submitting.current) { dialog.current?.close(); onClose() } }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true; setSaving(true); setError('')
    try {
      const result = await saveStockShortcut({ ...shortcut, label, url })
      if (!result.shortcut) { setError(result.error); return }
      dialog.current?.close()
      onSaved(result.shortcut)
    } catch { setError('Shortcut belum tersimpan. Periksa koneksi dan coba lagi.') }
    finally { submitting.current = false; setSaving(false) }
  }
  return <dialog ref={dialog} aria-labelledby="shortcut-editor-title" onCancel={event => { event.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-950/50">
    <div className="mb-5 flex items-center justify-between gap-3"><h2 id="shortcut-editor-title" className="font-semibold text-slate-900">Edit shortcut spreadsheet</h2><button type="button" disabled={saving} onClick={close} aria-label="Tutup editor shortcut" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"><X size={18} /></button></div>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">Nama tombol<input autoFocus required maxLength={60} value={label} onChange={event => setLabel(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        <label className="block text-sm font-medium text-slate-700">Link shortcut<input required type="url" maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/..." className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">Batal</button><button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button></div>
    </form>
  </dialog>
}

export default function StockShortcuts() {
  const { profile } = useOnlineConnection()
  const canEdit = canManageOrders(profile?.role)
  const [shortcuts, setShortcuts] = useState(DEFAULT_STOCK_SHORTCUTS)
  const [editing, setEditing] = useState<StockShortcut | null>(null)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    async function refresh() {
      const current = ++request.current
      try {
        const result = await getStockShortcuts()
        if (cancelled || current !== request.current) return
        if (result.shortcuts) setShortcuts(result.shortcuts)
        setError(result.error)
      } catch { if (!cancelled && current === request.current) setError('Shortcut belum dapat disinkronkan.') }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [profile?.id, profile?.role])

  return <div className="min-w-0 lg:flex-1">
    <div role="group" aria-label="Spreadsheet stok produksi" className="flex flex-wrap items-center gap-2 lg:justify-center">
      {shortcuts.map(shortcut => <div key={shortcut.id} className="inline-flex max-w-full items-stretch rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
        <a href={shortcut.url} target="_blank" rel="noopener noreferrer" title={`Buka ${shortcut.label} di tab baru`} className="inline-flex min-w-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:opacity-80"><Sheet className="h-4 w-4 shrink-0" /><span className="break-words">{shortcut.label}</span></a>
        {canEdit && <button type="button" onClick={() => setEditing(shortcut)} aria-label={`Edit shortcut ${shortcut.label}`} title={`Edit ${shortcut.label}`} className="flex shrink-0 items-center rounded-r-xl border-l border-emerald-200 px-2.5 hover:opacity-70"><Pencil size={14} /></button>}
      </div>)}
    </div>
    {canEdit && error && <p role="status" className="mt-2 text-xs text-red-600 lg:text-center">{error}</p>}
    {canEdit && editing && <ShortcutEditor key={editing.id} shortcut={editing} onClose={() => setEditing(null)} onSaved={shortcut => {
      request.current++
      setShortcuts(current => current.map(item => item.id === shortcut.id ? shortcut : item))
      setError(''); setEditing(null)
    }} />}
  </div>
}
