'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, PlusCircle, Search } from 'lucide-react'
import StatCard from '@/components/dashboard/stat-card'
import { StatusBadge } from '@/components/ui/badges'
import { formatDueDate, isOverdue } from '@/lib/utils'
import { SupabaseOrder } from '@/app/actions/order'

const STEP_COLORS: Record<string, string> = { ORDER_IN: 'slate', DESIGN: 'red', DESIGN_DONE: 'blue', PRINTING: 'amber', DONE: 'emerald', ARCHIVE: 'slate' }

function OrderTable({ title, orders, emptyMessage }: { title: string; orders: SupabaseOrder[]; emptyMessage: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-400">{orders.length} order</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50"><tr>
            {['SPK', 'Customer', 'Proses', 'Due Date'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{heading}</th>)}
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Aksi</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">{emptyMessage}</td></tr> : orders.map((order) => {
              const overdue = isOverdue(order.due_at, order.order_state)
              return (
                <tr key={order.id} className={overdue ? 'bg-red-50/30 transition-colors hover:bg-red-50/60' : 'transition-colors hover:bg-slate-50'}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2">{overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}<code className="font-mono text-sm font-semibold text-slate-900">{order.spk_code}</code></div></td>
                  <td className="px-4 py-3"><p className="text-sm font-medium text-slate-900">{order.customer.name}</p><p className="text-xs text-slate-400">{order.customer.phone}</p></td>
                  <td className="px-4 py-3"><StatusBadge stepCode={order.current_step.code} stepName={order.current_step.name} colorToken={STEP_COLORS[order.current_step.code]} size="sm" /></td>
                  <td className="px-4 py-3"><span className={overdue ? 'text-xs font-medium text-red-600' : 'text-xs font-medium text-slate-600'}>{formatDueDate(order.due_at, order.order_state)}</span></td>
                  <td className="px-4 py-3 text-right"><Link href={`/orders/${order.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">Track / Detail →</Link></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function DashboardClient({ initialOrders }: { initialOrders: SupabaseOrder[] }) {
  const [search, setSearch] = useState('')
  
  // Filter out finalized archive orders for dashboard view based on local logic or let it be
  const orders = initialOrders.filter(o => o.current_step.code !== 'ARCHIVE' || (o.current_step.code === 'ARCHIVE' && o.order_state !== 'completed'))

  const newOrders = orders.filter((order) => order.current_step.code === 'ORDER_IN')
  const inProgress = orders.filter((order) => order.order_state === 'active' && order.current_step.code !== 'ORDER_IN')
  const completedOrders = orders.filter((order) => order.order_state === 'completed')
  const overdueOrders = orders.filter((order) => isOverdue(order.due_at, order.order_state))
  
  const query = search.trim().toLowerCase()
  const phoneQuery = search.replace(/\D/g, '')
  
  const filteredOrders = orders.filter((order) => !query || order.spk_code.toLowerCase().includes(query) || order.customer.name.toLowerCase().includes(query) || order.customer.phone.includes(phoneQuery))
  const filteredActiveOrders = filteredOrders.filter((order) => order.order_state === 'active')
  const filteredCompletedOrders = filteredOrders.filter((order) => order.order_state === 'completed')

  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Link href="/orders/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"><PlusCircle className="h-4 w-4" /> Tambah Order</Link></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Order Baru" value={newOrders.length} icon={PackageCheck} color="amber" description="Menunggu dikerjakan" />
        <StatCard title="Sedang Diproses" value={inProgress.length} icon={Loader2} color="blue" description="Order aktif berjalan" />
        <StatCard title="Order Selesai" value={completedOrders.length} icon={CheckCircle2} color="emerald" description="Done dan Arsip yang masih di board" />
        <StatCard title="Terlambat" value={overdueOrders.length} icon={AlertTriangle} color="red" description="Due date sudah lewat" />
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input suppressHydrationWarning type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari SPK / Nama Customer / No. WhatsApp..." className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
      <div className="space-y-5">
        <OrderTable title="Order Aktif" orders={filteredActiveOrders} emptyMessage={search ? 'Order aktif tidak ditemukan.' : 'Belum ada order aktif.'} />
        <OrderTable title="Order Selesai · Masih di Board Produksi" orders={filteredCompletedOrders} emptyMessage={search ? 'Order selesai tidak ditemukan.' : 'Belum ada order selesai.'} />
      </div>
    </div>
  )
}
