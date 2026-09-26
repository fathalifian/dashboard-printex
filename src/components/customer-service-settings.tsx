'use client'

import { useState, type FormEvent } from 'react'
import { useCustomerService } from '@/components/customer-service-provider'
import { saveCustomerService } from '@/app/(dashboard)/settings/customer-service-actions'
import { whatsappUrl } from '@/lib/customer-service'

export default function CustomerServiceSettings() {
  const contact = useCustomerService()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const url = whatsappUrl(contact.number)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setMessage(''); setError('')
    try {
      const result = await saveCustomerService(draft ?? contact.number)
      if (result.error) { setError(result.error); return }
      contact.update(result.number); setDraft(null)
      setMessage(result.number ? 'Nomor Customer Service berhasil disimpan untuk seluruh cabang.' : 'Nomor dihapus. Tautan WhatsApp dinonaktifkan.')
    } catch { setError('Nomor belum tersimpan. Periksa koneksi lalu coba lagi.') }
    finally { setSaving(false) }
  }
  return <section id="customer-service" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-sm font-semibold text-slate-900">WhatsApp Customer Service</h2>
    <p className="mt-2 text-sm text-slate-500">Satu nomor tim TI Printex untuk seluruh cabang melalui tombol Hubungi Kami. Perubahan oleh Admin atau Owner berlaku untuk semua cabang.</p>
    <form onSubmit={submit} className="mt-5 space-y-3">
      <label htmlFor="customer-service-phone" className="block text-sm font-medium text-slate-700">Nomor WhatsApp</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="customer-service-phone" name="whatsapp" type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={draft ?? contact.number} disabled={contact.loading || saving || !!contact.error} onChange={event => { setDraft(event.target.value); setMessage(''); setError('') }} placeholder="Contoh: 081234567890" aria-describedby="customer-service-help" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 disabled:opacity-50" />
        <button type="submit" disabled={contact.loading || saving || !!contact.error} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan nomor'}</button>
      </div>
      <p id="customer-service-help" className="text-xs text-slate-500">Gunakan awalan 08 atau kode negara seperti +62. Kosongkan untuk menonaktifkan tautan.</p>
      {(error || contact.error) && <p role="alert" className="text-sm text-red-600">{error || contact.error}</p>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      {url && !contact.error && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium text-brand-600 hover:underline">Buka WhatsApp: +{contact.number}</a>}
    </form>
  </section>
}
