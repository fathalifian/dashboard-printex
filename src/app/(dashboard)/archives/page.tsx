'use client'

import { useState } from 'react'
import DateRangeFilter, { todayRange } from '@/components/date-range-filter'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { useAllOrders } from '@/lib/production-board'
import { jakartaDate } from '@/lib/process-metrics'

export default function ArchivesPage() {
  const allOrders = useAllOrders()
  const orders = allOrders.filter(order => order.board_stage === 'archive' && order.archive?.finalizedAt)
  const [query, setQuery] = useState('')
  const [range,setRange] = useState(todayRange)
  const filtered = orders.filter(order => (!query.trim() || `${order.spk_code} ${order.customer.name}`.toLowerCase().includes(query.trim().toLowerCase())) && (order.archive && jakartaDate(order.archive.finalizedAt!) >= range.start && jakartaDate(order.archive.finalizedAt!) <= range.end)).sort((a, b) => (b.archive?.finalizedAt ?? '').localeCompare(a.archive?.finalizedAt ?? ''))
  const totalMasuk = allOrders.filter(order => order.order_date >= range.start && order.order_date <= range.end).length
  return <div className="mx-auto max-w-7xl space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Total orderan masuk</p>
        <p className="mt-2 text-3xl font-bold text-slate-900">
          {totalMasuk}
        </p>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Total orderan selesai</p>
        <p className="mt-2 text-3xl font-bold text-slate-900">{filtered.length}</p>
      </section>
    </div>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"><label className="min-w-56 flex-1 text-xs font-medium text-slate-500">Cari order<div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Kode SPK atau nama customer" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900" /></div></label><DateRangeFilter value={range} onChange={setRange} /></div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4 text-sm text-slate-500">{filtered.length} order ditemukan</div><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Order', 'Customer', 'Produksi', 'Tanggal order', 'Selesai dari arsip', 'Penyerahan', 'Detail'].map(title => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{filtered.map(order => <tr key={order.id} className="border-t border-slate-100 text-slate-600"><td className="px-4 py-4 font-semibold text-slate-900">{order.spk_code}</td><td className="px-4 py-4">{order.customer.name}</td><td className="px-4 py-4">{order.production_type} · {order.meter} m</td><td className="px-4 py-4">{order.order_date}</td><td className="px-4 py-4">{order.archive ? new Date(order.archive.finalizedAt!).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum tercatat'}</td><td className="px-4 py-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">{order.archive?.deliveryMethod === 'pickup' ? 'Diambil pembeli' : order.archive?.deliveryMethod === 'delivery' ? 'Sudah dikirim' : 'Arsip lama'}</span></td><td className="px-4 py-4"><Link href={`/orders/${order.id}?from=archives`} className="font-medium text-brand-600">Lihat order</Link></td></tr>)}{!filtered.length && <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-400">Tidak ada arsip yang cocok dengan periode dan pencarian ini.</td></tr>}</tbody></table></div></section>
  </div>
}
