'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, PlusCircle, Search } from 'lucide-react'
import StatCard from '@/components/dashboard/stat-card'
import { StatusBadge } from '@/components/ui/badges'
import { useProductionOrders } from '@/lib/production-board'
import { formatDueDate, isOverdue } from '@/lib/utils'

const STEP_COLORS: Record<string, string> = { ORDER_IN: 'slate', DESIGN: 'red', DESIGN_DONE: 'blue', PRINTING: 'amber', PRESS: 'violet', DONE: 'emerald', ARCHIVE: 'slate' }
type DashboardOrder = ReturnType<typeof useProductionOrders>[number]

function OrderTable({ title, headerAction, orders, emptyMessage }: { title: string; headerAction?: React.ReactNode; orders: DashboardOrder[]; emptyMessage: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {headerAction}
        </div>
        <span className="text-xs text-slate-400">{orders.length} order</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed divide-y divide-slate-100">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[27%]" />
            <col className="w-[25%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
          </colgroup>
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
                  <td className="break-words px-4 py-3"><p className="text-sm font-medium text-slate-900">{order.customer.name}</p><p className="text-xs text-slate-400">{order.customer.phone}</p></td>
                  <td className="px-4 py-3"><StatusBadge stepCode={order.current_step.code} stepName={order.current_step.name} colorToken={STEP_COLORS[order.current_step.code]} size="sm" /></td>
                  <td className="px-4 py-3"><span className={overdue ? 'text-xs font-medium text-red-600' : 'text-xs font-medium text-slate-600'}>{formatDueDate(order.due_at, order.order_state)}</span></td>
                  <td className="px-4 py-3 text-right"><Link href={`/orders/${order.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">Lihat Detail</Link></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [completedFilter, setCompletedFilter] = useState<string>('all')
  const orders = useProductionOrders()
  const newOrders = orders.filter((order) => order.current_step.code === 'ORDER_IN')
  const inProgress = orders.filter((order) => order.order_state === 'active' && order.current_step.code !== 'ORDER_IN')
  const completedOrders = orders.filter((order) => order.order_state === 'completed')
  const overdueOrders = orders.filter((order) => isOverdue(order.due_at, order.order_state))
  const query = search.trim().toLowerCase()
  const filteredOrders = orders.filter((order) => !query || order.spk_code.toLowerCase().includes(query) || order.customer.name.toLowerCase().includes(query))
  
  const filteredActiveOrders = filteredOrders.filter((order) => {
    if (order.order_state !== 'active') return false
    if (activeFilter !== 'all' && order.board_stage !== activeFilter) return false
    return true
  })
  
  const filteredCompletedOrders = filteredOrders.filter((order) => {
    if (order.order_state !== 'completed') return false
    if (completedFilter !== 'all' && order.board_stage !== completedFilter) return false
    return true
  })

  const filterDropdown = (
    <select
      value={activeFilter}
      onChange={(e) => setActiveFilter(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="all">Semua Tahap</option>
      <option value="incoming">Order Masuk</option>
      <option value="design">Proses Desain</option>
      <option value="design_done">Menunggu Pembayaran</option>
      <option value="printing">Proses Sublim</option>
      <option value="press">Proses Press</option>
    </select>
  )

  const completedFilterDropdown = (
    <select
      value={completedFilter}
      onChange={(e) => setCompletedFilter(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="all">Semua Tahap</option>
      <option value="done">Order Selesai</option>
      <option value="archive">Order Diterima Customer</option>
    </select>
  )

  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Link href="/orders/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"><PlusCircle className="h-4 w-4" /> Tambah Order</Link></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Order Baru" value={newOrders.length} icon={PackageCheck} color="amber" description="Menunggu dikerjakan" />
        <StatCard title="Sedang Diproses" value={inProgress.length} icon={Loader2} color="blue" description="Order aktif berjalan" />
        <StatCard title="Order Selesai" value={completedOrders.length} icon={CheckCircle2} color="emerald" description="Order selesai dan diterima yang masih di board" />
        <StatCard title="Terlambat" value={overdueOrders.length} icon={AlertTriangle} color="red" description="Due date sudah lewat" />
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input suppressHydrationWarning type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari SPK / Nama Customer..." className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
      <div className="space-y-5">
        <OrderTable title="Order Aktif" headerAction={filterDropdown} orders={filteredActiveOrders} emptyMessage={search ? 'Order aktif tidak ditemukan.' : 'Belum ada order aktif.'} />
        <OrderTable title="Order Selesai" headerAction={completedFilterDropdown} orders={filteredCompletedOrders} emptyMessage={search ? 'Order selesai tidak ditemukan.' : 'Belum ada order selesai.'} />
      </div>
    </div>
  )
}
