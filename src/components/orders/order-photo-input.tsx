'use client'

import Image from 'next/image'
import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { orderPhotoExtension } from '@/lib/order-photo'

export function OrderPhotoInput({ file, onChange, disabled }: {
  file: File | null; onChange: (file: File | null) => void; disabled: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview) }
  }, [preview])

  const selectPhoto = (files: FileList | null) => {
    if (disabled || !files?.length) return
    if (files.length !== 1) { setError('Pilih satu foto order.'); return }
    const selected = files[0]
    try {
      orderPhotoExtension(selected)
      setPreview(URL.createObjectURL(selected))
      setError('')
      onChange(selected)
    } catch (error) { setError(error instanceof Error ? error.message : 'Foto tidak dapat dibaca.') }
  }

  return <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">Foto Order</h3>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled}
      aria-label="Pilih foto order" className="hidden"
      onChange={event => { selectPhoto(event.target.files); event.target.value = '' }} />
    <div className="relative">
      <button type="button" disabled={disabled} aria-label={file ? 'Ganti foto order' : 'Upload foto order'}
        onClick={() => input.current?.click()}
        onDragEnter={event => {
          event.preventDefault()
          if (disabled || !Array.from(event.dataTransfer.types).includes('Files')) return
          dragDepth.current++
          setDragging(true)
        }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy' }}
        onDragLeave={event => {
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        }}
        onDrop={event => {
          event.preventDefault()
          event.stopPropagation()
          dragDepth.current = 0
          setDragging(false)
          selectPhoto(event.dataTransfer.files)
        }}
        className={`flex min-h-80 w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-dashed p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${dragging && !disabled ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50 hover:border-brand-500'}`}>
        {file && preview
          ? <Image src={preview} alt="Pratinjau foto order" width={600} height={600} unoptimized className="max-h-80 w-full object-contain" />
          : <><Camera aria-hidden="true" className="h-12 w-12 text-slate-400" strokeWidth={1.5} /><span className="text-sm font-medium text-slate-500">upload disini</span></>}
      </button>
      {file && <button type="button" disabled={disabled} aria-label="Hapus foto order" title="Hapus foto order"
        onClick={() => { onChange(null); setPreview(''); setError('') }}
        className="absolute right-3 top-3 rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:text-red-600 disabled:opacity-50"><X aria-hidden="true" className="h-4 w-4" /></button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>
}
