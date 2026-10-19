'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { createClient } from '@/lib/supabase/client'
import { validateStockShortcut, type StockShortcut } from '@/lib/stock-shortcuts'
import { saveStockShortcut } from '@/app/(dashboard)/schedule/shortcut-actions'

function ShortcutForm({ shortcut, canEdit, onSaved }: { shortcut: StockShortcut; canEdit: boolean; onSaved: (shortcut: StockShortcut) => void }) {
  const [label, setLabel] = useState(shortcut.label)
  const [url, setUrl] = useState(shortcut.url)
  const [version, setVersion] = useState(shortcut.version)
  const [latest, setLatest] = useState<StockShortcut | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const changed = label !== shortcut.label || url !== shortcut.url
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setMessage(null)
    try {
      const result = await saveStockShortcut({ ...shortcut, label, url, version })
      if (!result.shortcut) { setMessage({ error: true, text: result.error }); setLatest(result.latest ?? null); return }
      setVersion(result.shortcut.version); setLabel(result.shortcut.label); setUrl(result.shortcut.url)
      setMessage({ error: false, text: 'Tersimpan.' }); onSaved(result.shortcut)
    } catch { setMessage({ error: true, text: 'Link belum tersimpan. Periksa koneksi lalu coba lagi.' }) }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
    <fieldset disabled={!canEdit || saving} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <label className="text-xs font-medium text-slate-600">Nama tombol<input required maxLength={60} value={label} onChange={event => setLabel(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900" /></label>
      <label className="text-xs font-medium text-slate-600">Link spreadsheet<input type="url" maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/..." className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900" /></label>
    </fieldset>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {shortcut.url && <a href={shortcut.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><ExternalLink aria-hidden="true" className="h-3 w-3" />Buka</a>}
      {message && <p role={message.error ? 'alert' : 'status'} className={'text-xs ' + (message.error ? 'text-red-600' : 'text-emerald-700')}>{message.text}</p>}
      {latest && <button type="button" className="text-xs font-semibold text-brand-600" onClick={() => { setLabel(latest.label); setUrl(latest.url); setVersion(latest.version); setLatest(null); setMessage(null) }}>Muat data terbaru</button>}
      {canEdit && <button type="submit" disabled={saving || !changed} className="ml-auto rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{saving ? 'Menyimpan...' : 'Simpan'}</button>}
    </div>
  </form>
}

/** The two stock spreadsheet buttons shown on the production board. */
export default function StockShortcutSettings() {
  const { profile } = useOnlineConnection()
  const canEdit = canManageOrders(profile?.role)
  const [current, setState] = useState<{ shortcuts: StockShortcut[]; error: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void createClient().from('stock_shortcuts').select('id,label,url,version').order('id').then(({ data, error }) => {
      if (cancelled) return
      try {
        if (error || data?.length !== 2) throw new Error()
        setState({ shortcuts: data.map(row => validateStockShortcut(row as StockShortcut)), error: '' })
      } catch { setState({ shortcuts: [], error: 'Link stok belum dapat dimuat.' }) }
    })
    return () => { cancelled = true }
  }, [])

  if (!current) return <p role="status" className="text-sm text-slate-500">Memuat link stok...</p>
  if (current.error) return <p role="alert" className="text-sm text-red-600">{current.error}</p>
  return <div className="space-y-3">
    {current.shortcuts.map(shortcut => <ShortcutForm key={`${shortcut.id}:${shortcut.version}`} shortcut={shortcut} canEdit={canEdit}
      onSaved={saved => setState(value => value && { ...value, shortcuts: value.shortcuts.map(item => item.id === saved.id ? saved : item) })} />)}
    <p className="text-xs text-slate-500">Tombol ini tampil di Board Produksi. Kosongkan link untuk menonaktifkan tombol.</p>
  </div>
}
