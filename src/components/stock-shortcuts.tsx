'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Pencil, Sheet, X } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { DEFAULT_STOCK_SHORTCUTS, validateStockShortcut, type StockShortcut } from '@/lib/stock-shortcuts'
import { createClient } from '@/lib/supabase/client'
import { saveStockShortcut } from '@/app/(dashboard)/schedule/shortcut-actions'

function ShortcutEditor({ shortcut, onClose, onSaved }: { shortcut: StockShortcut; onClose: () => void; onSaved: (shortcut: StockShortcut) => void }) {
  const { branchId } = useOnlineConnection()
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [label, setLabel] = useState(shortcut.label)
  const [url, setUrl] = useState(shortcut.url)
  const [version, setVersion] = useState(shortcut.version)
  const [latest, setLatest] = useState<StockShortcut | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  function close() { if (!submitting.current) { dialog.current?.close(); onClose() } }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true; setSaving(true); setError('')
    try {
      const result = await saveStockShortcut({ ...shortcut, label, url, version }, branchId)
      if (!result.shortcut) { setError(result.error); setLatest(result.latest ?? null); return }
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
        <label className="block text-sm font-medium text-slate-700">Link shortcut<input type="url" maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/..." className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {latest && <button type="button" disabled={saving} className="text-sm font-semibold text-brand-600" onClick={() => {
        setLabel(latest.label); setUrl(latest.url); setVersion(latest.version); setLatest(null); setError('')
      }}>Muat data terbaru</button>}
      <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">Batal</button><button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button></div>
    </form>
  </dialog>
}

export default function StockShortcuts() {
  const { profile, branchId, branches } = useOnlineConnection()
  const hasBranches = !!branches
  const canEdit = canManageOrders(profile?.role)
  const [shortcuts, setShortcuts] = useState<StockShortcut[]>(DEFAULT_STOCK_SHORTCUTS.map(item => ({ ...item, url: '' })))
  const [editing, setEditing] = useState<StockShortcut | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const request = useRef(0)
  useEffect(() => {
    if (!profile?.id || (hasBranches && !branchId)) return
    let cancelled = false
    let refreshing = false
    async function refresh() {
      if (refreshing) return
      refreshing = true
      const current = ++request.current
      try {
        // RLS authenticates the session and limits reads to accessible branches.
        // One direct read avoids the sequential Server Action authorization calls.
        let query = createClient().from(hasBranches ? 'branch_stock_shortcuts' : 'stock_shortcuts').select('id,label,url,version')
        if (branchId) query = query.eq('branch_id', branchId)
        const { data, error } = await query.order('id')
        if (error || data?.length !== 2) throw new Error('Shortcut belum dapat dimuat.')
        const shortcuts = data.map(row => validateStockShortcut(row as StockShortcut))
        if (cancelled || current !== request.current) return
        setShortcuts(shortcuts); setLoaded(true); setError('')
      } catch { if (!cancelled && current === request.current) setError('Shortcut belum dapat disinkronkan.') }
      finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [profile?.id, profile?.role, branchId, hasBranches])

  return <div className="shrink-0">
    <div aria-busy={!loaded && !(hasBranches && !branchId)} role="group" aria-label="Spreadsheet stok produksi" className="flex flex-nowrap items-center gap-2">
      {shortcuts.map(shortcut => <div key={shortcut.id} className="inline-flex shrink-0 items-stretch rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
        <a href={shortcut.url || undefined} aria-disabled={!shortcut.url} target="_blank" rel="noopener noreferrer" title={!loaded ? 'Memuat shortcut...' : shortcut.url ? `Buka ${shortcut.label} di tab baru` : 'Link belum diatur untuk cabang ini'} className="inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors hover:opacity-80"><Sheet className="h-4 w-4 shrink-0" /><span className="whitespace-nowrap">{shortcut.label}</span></a>
        {canEdit && <button type="button" disabled={!loaded} onClick={() => setEditing(shortcut)} aria-label={`Edit shortcut ${shortcut.label}`} title={loaded ? `Edit ${shortcut.label}` : 'Memuat shortcut terbaru'} className="flex shrink-0 items-center rounded-r-xl border-l border-emerald-200 px-2.5 hover:opacity-70 disabled:cursor-wait disabled:opacity-40"><Pencil size={14} /></button>}
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
