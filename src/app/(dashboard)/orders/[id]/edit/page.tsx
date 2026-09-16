'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Save } from 'lucide-react'
import { updateOrder, useBoardOrders, type OrderEditInput } from '@/lib/production-board'

const PRODUCTION_TYPES = ['Sublim', 'DTF', 'Umbul-umbul', 'Batik', 'Jersey']

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>()
  const order = useBoardOrders().find((item) => item.id === id)
  const [draft, setDraft] = useState<OrderEditInput | null>(null)

  if (!order) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Order tidak ditemukan.</div>

  const form = draft ?? {
    spkCode: order.spk_code,
    customerName: order.customer.name,
    productionType: order.production_type,
    meter: order.meter,
    customerType: order.customer_type,
    orderDate: order.order_date,
    dueDate: order.due_at,
    notes: order.notes,
  }

  function setField<K extends keyof OrderEditInput>(field: K, value: OrderEditInput[K]) {
    setDraft({ ...form, [field]: value })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try { await updateOrder(id, form) } catch { return }
    window.location.replace(new URL('/schedule', window.location.origin).toString())
  }

  const inputClass = 'mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/schedule" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">Kembali ke Board Produksi</Link>
      <div><h2 className="text-lg font-semibold text-slate-900">{order.spk_code}</h2></div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Kode SPK<input required value={form.spkCode} onChange={(e) => setField('spkCode', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Nama Customer<input required value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Jenis Produksi<select required value={form.productionType} onChange={(e) => setField('productionType', e.target.value)} className={inputClass}>{PRODUCTION_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Jumlah Meter<input required min="0" step="0.01" type="number" value={form.meter} onChange={(e) => setField('meter', Number(e.target.value))} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Tipe Customer<select value={form.customerType} onChange={(e) => setField('customerType', e.target.value)} className={inputClass}><option value="regular">Customer Biasa</option><option value="priority">Customer Prioritas</option></select></label>
          <label className="text-sm font-medium text-slate-700">Tanggal Order<input required type="date" value={form.orderDate} onChange={(e) => setField('orderDate', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Due Date<input required type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Catatan<textarea rows={4} value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputClass} /></label>
        </div>
        <div className="flex justify-end gap-3"><Link href="/schedule" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Batal</Link><button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Save className="h-4 w-4" /> Simpan Perubahan</button></div>
      </form>
    </div>
  )
}
