'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { errorMessage, updateOrder, useBoardOrders, useOnlineConnection, type OrderEditInput } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import OrderPhoto from '@/components/order-photo'

const PRODUCTION_TYPES = ['Sublim', 'DTF', 'Umbul-umbul', 'Batik', 'Jersey']

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const order = useBoardOrders().find((item) => item.id === id)
  const connection = useOnlineConnection()
  const [draft, setDraft] = useState<OrderEditInput | null>(null)
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!order) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Order tidak ditemukan.</div>

  const form = draft ?? {
    spkCode: order.spk_code,
    customerName: order.customer.name,
    productionType: order.production_type,
    meter: order.meter,
    paperWidth: order.paper_width ?? null,
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
    if (submitting.current || connection.busy || connection.dataLoading || connection.state !== 'ready') return
    submitting.current = true
    setSaving(true); setError('')
    try {
      await updateOrder(id, { ...form, paperWidth: form.productionType === 'DTF' ? '0.6' : form.paperWidth === '0.6' ? null : form.paperWidth })
      router.replace('/schedule')
    } catch (error) { setError(errorMessage(error)) }
    finally { submitting.current = false; setSaving(false) }
  }

  const disabled = saving || connection.busy || connection.dataLoading || connection.state !== 'ready'
  const inputClass = 'mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/schedule" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">Kembali ke Board Produksi</Link>
      <div><h2 className="page-title">{order.spk_code}</h2></div>

      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={saving || connection.busy}>
        <fieldset disabled={disabled} className="min-w-0 space-y-5">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Kode SPK<input required value={form.spkCode} onChange={(e) => setField('spkCode', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Nama Customer<input required value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Jenis Produksi<select required value={form.productionType} onChange={(e) => setField('productionType', e.target.value)} className={inputClass}>{PRODUCTION_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Jumlah Meter<input required min="0" step="0.01" type="number" value={form.meter} onChange={(e) => setField('meter', Number(e.target.value))} className={inputClass} /></label>
          {form.productionType === 'DTF' && <label className="text-sm font-medium text-slate-700">Kertas<input readOnly value="DTF 0,6 m" className={inputClass} /></label>}
          {(!!form.productionType && form.productionType !== 'DTF') && <label className="text-sm font-medium text-slate-700">Lebar Kertas<select required value={form.paperWidth === '0.6' ? '' : form.paperWidth ?? ''} onChange={e=>setField('paperWidth',e.target.value)} className={inputClass}><option value="">Pilih lebar kertas...</option><option value="1.2">1,2 meter</option><option value="1.6">1,6 meter</option><option value="1.8">1,8 meter</option></select></label>}
          <label className="text-sm font-medium text-slate-700">Tipe Customer<select value={form.customerType} onChange={(e) => setField('customerType', e.target.value)} className={inputClass}><option value="regular">Customer Biasa</option><option value="priority">Customer Prioritas</option></select></label>
          <label className="text-sm font-medium text-slate-700">Tanggal Order<input required type="date" value={form.orderDate} onChange={(e) => setField('orderDate', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Due Date<input required type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Catatan<textarea rows={4} value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputClass} /></label>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Foto Order</h3>
          <OrderPhoto orderId={order.id} spkCode={order.spk_code} path={order.photo_path ?? null} editable={canManageOrders(connection.profile?.role) && order.board_stage !== 'archive'} />
          <p className="mt-3 text-xs text-slate-500">Perubahan foto langsung disimpan. Gunakan Simpan Perubahan untuk menyimpan data order.</p>
        </section>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3"><Link href="/schedule" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Batal</Link><button type="submit" disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button></div>
      </form>
    </div>
  )
}
