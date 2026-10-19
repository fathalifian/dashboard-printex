'use client'

import { useEffect, useId, useRef } from 'react'

export default function DeleteConfirmation({ title, message, busy, error, onCancel, onConfirm }: {
  title: string; message: string; busy: boolean; error?: string; onCancel: () => void; onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/50">
    <h3 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h3>
    <p id={messageId} className="mt-2 text-sm text-slate-600">{message}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    <div className="mt-6 flex justify-end gap-3">
      <button type="button" autoFocus disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Batal</button>
      <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Menghapus...' : 'Hapus'}</button>
    </div>
  </dialog>
}
