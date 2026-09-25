'use client'

import Image from 'next/image'
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { errorMessage, saveOrderPhoto } from '@/lib/production-board'
import { ORDER_PHOTO_BUCKET, orderPhotoExtension } from '@/lib/order-photo'

export default function OrderPhoto({ orderId, spkCode, path, editable }: {
  orderId: string; spkCode: string; path: string | null; editable: boolean
}) {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState({ path: '', url: '', error: '' })
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    const storage = createClient().storage.from(ORDER_PHOTO_BUCKET)
    async function refresh() {
      try {
        const { data, error } = await storage.createSignedUrl(path!, 600)
        if (!cancelled) setPhoto({ path: path!, url: data?.signedUrl ?? '', error: error ? 'Foto belum dapat dimuat.' : '' })
      } catch {
        if (!cancelled) setPhoto({ path: path!, url: '', error: 'Foto belum dapat dimuat.' })
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 8 * 60 * 1000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [path, retry])

  async function save(file: File | null) {
    if (saving) return
    setSaving(true); setError('')
    try {
      if (file) orderPhotoExtension(file)
      await saveOrderPhoto(orderId, file)
      setConfirmRemove(false)
    } catch (error) { setError(errorMessage(error)) }
    finally { setSaving(false) }
  }
  function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void save(file)
  }
  const url = photo.path === path ? photo.url : ''
  const loadError = photo.path === path ? photo.error : ''

  if (!path && !editable) return null
  return <div className="mt-3 border-t border-slate-100 pt-3" draggable={false} onDragStart={event => { event.preventDefault(); event.stopPropagation() }} onPointerDown={event => event.stopPropagation()}>
    {editable && <p className="mb-2 text-xs font-medium text-slate-500">Foto order (opsional)</p>}
    {path && (loadError ? <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
      <p role="status">{loadError}</p>
      <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 inline-flex items-center gap-1 text-brand-600"><RefreshCw size={12} />Coba lagi</button>
    </div> : url ? <a href={url} target="_blank" rel="noreferrer" draggable={false} aria-label={`Lihat foto ${spkCode} ukuran penuh`} className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <Image unoptimized src={url} alt={`Foto order ${spkCode}`} width={640} height={480} draggable={false} className="max-h-96 w-full object-contain" onError={() => setPhoto({ path, url: '', error: 'Foto belum dapat dimuat.' })} />
    </a> : <p role="status" className="py-4 text-center text-xs text-slate-500">Memuat foto...</p>)}
    {editable && <>
      <input ref={input} id={inputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={select} disabled={saving} className="sr-only" tabIndex={-1} aria-label={`Pilih foto ${spkCode}`} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => input.current?.click()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><ImagePlus size={14} />{saving ? 'Menyimpan...' : path ? 'Ganti foto' : 'Tambah foto'}</button>
        {path && <button type="button" disabled={saving} onClick={() => setConfirmRemove(true)} aria-label={`Hapus foto ${spkCode}`} title="Hapus foto" className="rounded-lg border border-slate-200 p-2 text-red-600 disabled:opacity-50"><Trash2 size={14} /></button>}
      </div>
      {!path && <p className="mt-1 text-[10px] text-slate-400">JPG, PNG, WebP · Maks. 5 MB</p>}
      {confirmRemove && <div className="mt-2 text-xs text-slate-600"><p>Hapus foto order ini?</p><div className="mt-2 flex gap-3"><button type="button" disabled={saving} onClick={() => void save(null)} className="font-semibold text-red-600">Hapus foto</button><button type="button" disabled={saving} onClick={() => setConfirmRemove(false)}>Batal</button></div></div>}
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>
}
