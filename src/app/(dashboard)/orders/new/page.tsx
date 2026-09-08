'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { jakartaDate } from '@/lib/process-metrics'
import { addOrder } from '@/lib/production-board'

const PRODUCTION_TYPES = ['Sublim', 'DTF', 'Umbul-umbul', 'Batik', 'Jersey']
export default function NewOrderPage() {
  const router = useRouter()
  const requestId = useRef<string | null>(null)
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
    requestId.current ??= crypto.randomUUID()
    try { await addOrder({
      customerName: form.customer.trim(),
      productionType: form.productionType,
      meter: Number(form.meter),
      customerType: form.customerType,
      orderDate: form.orderDate,
      dueDate: form.dueDate,
      notes: form.notes.trim(),
    }, requestId.current) } catch { return }
    router.replace('/schedule')
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          Kembali
        </Link>
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-900">Tambah Order Baru</h2>
        <p className="text-sm text-slate-400 mt-0.5">Isi data order customer</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Customer Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">Data Customer</h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="customer" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Production Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">Detail Produksi</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="productionType" className="block text-sm font-medium text-slate-700 mb-1.5">
                Jenis Produksi <span className="text-red-500">*</span>
              </label>
              <select
                id="productionType"
                name="productionType"
                value={form.productionType}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Pilih jenis...</option>
                {PRODUCTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="meter" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipe Customer</label>
              <div className="flex gap-3 pt-1">
                {[{ value: 'regular', label: 'Customer Biasa' }, { value: 'priority', label: 'Customer Prioritas' }].map(type => (
                  <label key={type.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customerType"
                      value={type.value}
                      checked={form.customerType === type.value}
                      onChange={handleChange}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{type.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Date Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">Jadwal</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="orderDate" className="block text-sm font-medium text-slate-700 mb-1.5">
                Tanggal Order <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="orderDate"
                name="orderDate"
                value={form.orderDate}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="dueDate" className="block text-sm font-medium text-slate-700 mb-1.5">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="dueDate"
                name="dueDate"
                value={form.dueDate}
                onChange={handleChange}
                required
                className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1.5">Catatan</label>
            <textarea
              id="notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Catatan khusus produksi..."
              className="block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Link
            href="/orders"
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Batal
          </Link>
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Simpan Order
          </button>
        </div>
      </form>
    </div>
  )
}
