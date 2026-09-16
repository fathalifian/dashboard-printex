'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, PlusCircle, AlertTriangle, Eye, Pencil, Trash2, X } from 'lucide-react'
import { StatusBadge, CustomerTypeBadge } from '@/components/ui/badges'
import { formatDueDate, isOverdue } from '@/lib/utils'
import { deleteOrder, useBoardOrders } from '@/lib/production-board'

const STEP_COLORS: Record<string, string> = {
  ORDER_IN: 'slate', DESIGN: 'red', DESIGN_DONE: 'blue', PRINTING: 'amber', PRESS: 'violet', DONE: 'emerald', ARCHIVE: 'slate',
}

const FILTERS = [
  { label: 'Semua', value: 'all' },
  { label: 'Order Masuk', value: 'ORDER_IN' },
  { label: 'Design', value: 'DESIGN' },
  { label: 'Menunggu Pembayaran', value: 'DESIGN_DONE' },
  { label: 'Proses Sublim', value: 'PRINTING' },
  { label: 'Proses Press', value: 'PRESS' },
  { label: 'Order Selesai', value: 'DONE' },
  { label: 'Terlambat', value: 'overdue' },
]

export default function OrdersPage() {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const orders = useBoardOrders()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingDelete = orders.find((order) => order.id === pendingDeleteId) ?? null

  const filtered = orders.filter(order => {
    const matchesSearch = !search.trim() ||
      order.spk_code.toLowerCase().includes(search.toLowerCase()) ||
      order.customer.name.toLowerCase().includes(search.toLowerCase())

    const overdue = isOverdue(order.due_at, order.order_state)
    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'overdue' && overdue) ||
      order.current_step.code === activeFilter

    return matchesSearch && matchesFilter
  })

  async function confirmDelete() {
    if (!pendingDeleteId) return
    try { await deleteOrder(pendingDeleteId); setPendingDeleteId(null) } catch { /* Connection banner displays the error. */ }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400 mt-0.5">{orders.length} order belum diarsipkan · <Link href="/archives" className="text-blue-600">Lihat arsip</Link></p>
        </div>
        <Link
          href="/orders/new"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          Tambah Order
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Cari SPK / Nama Customer..."
          className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(filter => (
          <button
            key={filter.value}
            onClick={() => setActiveFilter(filter.value)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              activeFilter === filter.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {filter.label}
            {filter.value === 'overdue' && (
              <span className="ml-1.5 text-xs">({orders.filter(o => isOverdue(o.due_at, o.order_state)).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Kode SPK</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Proses Sekarang</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Jenis</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Meter</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tipe Customer</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Due Date</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                    {search || activeFilter !== 'all' ? 'Order tidak ditemukan dengan filter ini.' : 'Belum ada order.'}
                  </td>
                </tr>
              ) : filtered.map(order => {
                const overdue = isOverdue(order.due_at, order.order_state)
                return (
                  <tr
                    key={order.id}
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${overdue && order.order_state !== 'completed' ? 'bg-red-50/20' : ''}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {overdue && order.order_state !== 'completed' && (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                        )}
                        <code className="font-mono text-sm font-semibold text-slate-900">{order.spk_code}</code>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-slate-900">{order.customer.name}</p>
                      <p className="text-xs text-slate-400">{order.customer.phone}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge
                        stepCode={order.current_step.code}
                        stepName={order.current_step.name}
                        colorToken={STEP_COLORS[order.current_step.code]}
                        size="sm"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700">{order.production_type}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-700">{order.meter} m</td>
                    <td className="px-5 py-3.5">
                      <CustomerTypeBadge customerType={order.customer_type} size="sm" />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium ${overdue && order.order_state !== 'completed' ? 'text-red-600' : 'text-slate-600'}`}>
                        {formatDueDate(order.due_at, order.order_state)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/orders/${order.id}?from=orders`} aria-label={`Lihat detail ${order.spk_code}`} title="Detail" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100">
                          <Eye className="h-4 w-4" />
                        </Link>
                        <Link href={`/orders/${order.id}/edit`} aria-label={`Edit ${order.spk_code}`} title="Edit" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100">
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button type="button" onClick={() => setPendingDeleteId(order.id)} aria-label={`Hapus ${order.spk_code}`} title="Hapus" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-list-order-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertTriangle className="h-5 w-5" /></div>
              <button type="button" onClick={() => setPendingDeleteId(null)} aria-label="Tutup konfirmasi" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <h3 id="delete-list-order-title" className="mt-4 text-lg font-bold text-slate-900">Hapus order ini?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600"><span className="font-semibold text-slate-900">{pendingDelete.spk_code} — {pendingDelete.customer.name}</span> akan dihapus dari seluruh tampilan dan data order yang terhubung.</p>
            <p className="mt-2 text-xs font-medium text-red-600">Tindakan ini tidak dapat dibatalkan.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">Batal</button>
              <button type="button" onClick={confirmDelete} autoFocus className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"><Trash2 className="h-4 w-4" /> Hapus Permanen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
