'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, Archive } from 'lucide-react'
import { MOCK_ORDERS } from '@/lib/mock-data'
import { StatusBadge } from '@/components/ui/badges'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

const STEP_COLORS: Record<string, string> = {
  ORDER_IN: 'amber',
  DESIGN: 'red',
  DESIGN_DONE: 'blue',
  PRINTING: 'amber',
  DONE: 'emerald',
  ARCHIVE: 'slate',
}

export default function HistoryPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'done' | 'archive'>('all')

  const completedOrders = MOCK_ORDERS.filter(o => o.order_state === 'completed')

  const filtered = completedOrders.filter(o => {
    const matchSearch = !search.trim() ||
      o.spk_code.toLowerCase().includes(search.toLowerCase()) ||
      o.customer.name.toLowerCase().includes(search.toLowerCase()) ||
      o.customer.phone.includes(search.replace(/\D/g, ''))
    const matchFilter =
      filter === 'all' ||
      (filter === 'done' && o.current_step.code === 'DONE') ||
      (filter === 'archive' && o.current_step.code === 'ARCHIVE')
    return matchSearch && matchFilter
  })

  const doneCount = completedOrders.filter(o => o.current_step.code === 'DONE').length
  const archiveCount = completedOrders.filter(o => o.current_step.code === 'ARCHIVE').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Riwayat Order</h2>
          <p className="text-sm text-slate-400 mt-0.5">{completedOrders.length} order selesai</p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-800">Done: {doneCount}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
          <Archive className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Arsip: {archiveCount}</span>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari SPK / Nama Customer / No. WhatsApp..."
            className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {([['all', 'Semua'], ['done', 'Done'], ['archive', 'Arsip']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={cn(
                'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                filter === val
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Kode SPK</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Jenis</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Meter</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tgl Order</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Due Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                    {search ? 'Order tidak ditemukan.' : 'Belum ada riwayat order.'}
                  </td>
                </tr>
              ) : filtered.map(order => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <code className="font-mono text-sm font-semibold text-slate-900">{order.spk_code}</code>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-slate-900">{order.customer.name}</p>
                    <p className="text-xs text-slate-400">{order.customer.phone}</p>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-700">{order.production_type}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-700">{order.meter} m</td>
                  <td className="px-5 py-3.5 text-sm text-slate-600">{formatDate(order.order_date)}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-600">{formatDate(order.due_at)}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge
                      stepCode={order.current_step.code}
                      stepName={order.current_step.name}
                      colorToken={STEP_COLORS[order.current_step.code]}
                      size="sm"
                    />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Lihat →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
