'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { jakartaDate } from '@/lib/process-metrics'
import { addOrder, saveOrderPhoto, errorMessage } from '@/lib/production-board'

import { compressOrderPhoto } from '@/lib/order-photo'
import { OrderPhotoInput } from '@/components/order-photo-input'

const PRODUCTION_TYPES = ['Sublim', 'DTF', 'Umbul-umbul', 'Batik', 'Jersey']
export default function NewOrderPage() {
  const router = useRouter()
  const requestId = useRef<string | null>(null)
  const submitting = useRef(false)
  const created = useRef(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [orderSaved, setOrderSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    customer: '',
    productionType: '',
    meter: '',
    customerType: 'regular',
    orderDate: jakartaDate(new Date()),
    dueDate: '',
    notes: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setSaving(true); setError('')
    requestId.current ??= crypto.randomUUID()
    try {
      const compressed = photo ? await compressOrderPhoto(photo) : null
      if (!created.current) {
      await addOrder({
      customerName: form.customer.trim(),
      productionType: form.productionType,
      meter: Number(form.meter),
      customerType: form.customerType,
      orderDate: form.orderDate,
      dueDate: form.dueDate,
      notes: form.notes.trim(),
      }, requestId.current)
      created.current = true
      setOrderSaved(true)
      }
      if (compressed) await saveOrderPhoto(requestId.current, compressed)
      router.replace('/schedule')
    } catch (error) {
      setError((created.current ? 'Order sudah tersimpan, tetapi foto belum berhasil disimpan. Coba lagi atau lanjutkan tanpa foto. ' : '') + errorMessage(error))
    } finally { submitting.current = false; setSaving(false) }
  }

  return (
    <div className="max-w-7xl space-y-2">
      <div className="flex items-center gap-3">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          Kembali
        </Link>
      </div>


      <form onSubmit={handleSubmit} className="space-y-2" aria-busy={saving}>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <fieldset disabled={saving || orderSaved} className="min-w-0 space-y-2">
        {/* Customer Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-1">Data Customer</h3>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label htmlFor="customer" className="block text-sm font-medium text-slate-700 mb-1">
                Nama Customer <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="customer"
                name="customer"
                value={form.customer}
                onChange={handleChange}
                required
                placeholder="Contoh: Nanang Sport"
                className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Production Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-1">Detail Produksi</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="productionType" className="block text-sm font-medium text-slate-700 mb-1">
                Jenis Produksi <span className="text-red-500">*</span>
              </label>
              <select
                id="productionType"
                name="productionType"
                value={form.productionType}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Pilih jenis...</option>
                {PRODUCTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="meter" className="block text-sm font-medium text-slate-700 mb-1">
                Jumlah Meter <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                id="meter"
                name="meter"
                value={form.meter}
                onChange={handleChange}
                required
                min="0"
                step="0.01"
                placeholder="0"
                className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipe Customer</label>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {[{ value: 'regular', label: 'Customer Biasa' }, { value: 'priority', label: 'Customer Prioritas' }].map(type => (
                  <label key={type.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customerType"
                      value={type.value}
                      checked={form.customerType === type.value}
                      onChange={handleChange}
                      className="text-brand-600"
                    />
                    <span className="text-sm text-slate-700">{type.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Date Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-1">Jadwal</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="orderDate" className="block text-sm font-medium text-slate-700 mb-1">
                Tanggal Order <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="orderDate"
                name="orderDate"
                value={form.orderDate}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="dueDate" className="block text-sm font-medium text-slate-700 mb-1">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="dueDate"
                name="dueDate"
                value={form.dueDate}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1">Catatan</label>
            <textarea
              id="notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Catatan khusus produksi..."
              className="block w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>

        </fieldset>
        <OrderPhotoInput file={photo} onChange={setPhoto} disabled={saving} />
        </div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-600">{error}</div>}
        {orderSaved && !saving && <button type="button" onClick={() => router.replace('/schedule')} className="text-sm font-semibold text-brand-600">Lanjutkan tanpa foto</button>}
        {/* Actions */}
        <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-[var(--background)] py-2">
          <Link
            href="/orders"
            aria-disabled={saving}
            onClick={event => { if (saving) event.preventDefault() }}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Batal
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : (orderSaved ? 'Coba Simpan Foto Lagi' : 'Simpan Order')}
          </button>
        </div>
      </form>
    </div>
  )
}
