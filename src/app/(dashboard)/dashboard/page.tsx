'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, PlusCircle, Search } from 'lucide-react'
import StatCard from '@/components/dashboard/stat-card'
import ProductionFlow from '@/components/dashboard/production-flow'
import { StatusBadge } from '@/components/ui/badges'
import { BOARD_STAGE_META, useProductionOrders, useOnlineConnection } from '@/lib/production-board'
import { formatDueDate, isOverdue } from '@/lib/utils'
import { canManageOrders } from '@/lib/access-control'
import { PROCESS_STAGES, type ProcessStage } from '@/lib/process-metrics'

const STEP_COLORS: Record<string, string> = { ORDER_IN: 'slate', DESIGN: 'red', DESIGN_DONE: 'blue', PRINTING: 'amber', PRESS: 'violet', DONE: 'emerald', ARCHIVE: 'slate' }
type DashboardOrder = ReturnType<typeof useProductionOrders>[number]

function OrderTable({ title, headerAction, orders, emptyMessage, canViewDetails }: { canViewDetails: boolean; title: string; headerAction?: React.ReactNode; orders: DashboardOrder[]; emptyMessage: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {headerAction}
        </div>
        <span role="status" className="whitespace-nowrap text-xs text-slate-400">{orders.length} order</span>
      </div>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Daftar order, geser untuk melihat seluruh kolom">
        <table className="w-full min-w-[760px] table-fixed divide-y divide-slate-100">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[27%]" />
            <col className="w-[25%]" />
            <col className="w-[20%]" />
            {canViewDetails && <col className="w-[12%]" />}
          </colgroup>
          <thead className="bg-slate-50"><tr>
            {['SPK', 'Customer', 'Proses', 'Tenggat'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{heading}</th>)}
            {canViewDetails && <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Aksi</th>}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 ? <tr><td colSpan={canViewDetails ? 5 : 4} className="px-4 py-10 text-center text-sm text-slate-400">{emptyMessage}</td></tr> : orders.map((order) => {
              const overdue = isOverdue(order.due_at, order.order_state)
              return (
                <tr key={order.id} className={overdue ? 'bg-red-50/30 transition-colors hover:bg-red-50/60' : 'transition-colors hover:bg-slate-50'}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2">{overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}<code className="font-mono text-sm font-semibold text-slate-900">{order.spk_code}</code></div></td>
                  <td className="break-words px-4 py-3"><p className="text-sm font-medium text-slate-900">{order.customer.name}</p><p className="text-xs text-slate-400">{order.customer.phone}</p></td>
                  <td className="px-4 py-3"><StatusBadge stepCode={order.current_step.code} stepName={order.current_step.name} colorToken={STEP_COLORS[order.current_step.code]} size="sm" /></td>
                  <td className="px-4 py-3"><span className={overdue ? 'text-xs font-medium text-red-600' : 'text-xs font-medium text-slate-600'}>{formatDueDate(order.due_at, order.order_state)}</span></td>
                  {canViewDetails && <td className="px-4 py-3 text-right"><Link href={`/orders/${order.id}?from=dashboard`} className="text-xs font-medium text-brand-600 hover:text-brand-800">Lihat Detail</Link></td>}
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
  const [stage, setStage] = useState<ProcessStage | 'all'>('all')
  const orders = useProductionOrders()
  const canViewDetails = canManageOrders(useOnlineConnection().profile?.role)
  const newOrders = orders.filter((order) => order.current_step.code === 'ORDER_IN')
  const inProgress = orders.filter((order) => order.order_state === 'active' && order.current_step.code !== 'ORDER_IN')
  const completedOrders = orders.filter((order) => order.order_state === 'completed')
  const overdueOrders = orders.filter((order) => isOverdue(order.due_at, order.order_state))
  const query = search.trim().toLowerCase()
  const filteredOrders = orders.filter((order) => !query || order.spk_code.toLowerCase().includes(query) || order.customer.name.toLowerCase().includes(query))
  
  const visibleOrders = filteredOrders.filter(order => stage === 'all' || order.board_stage === stage)
  const filterDropdown = <select aria-label="Filter tahap order" value={stage} onChange={event => setStage(event.target.value as ProcessStage | 'all')} className="max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:outline-2 focus:outline-brand-600">
    <option value="all">Semua tahap</option>
    {PROCESS_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}
  </select>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard produksi</h2><p className="mt-1 text-sm text-slate-500">Pantau progres dan tenggat dari {orders.length} order di board.</p></div>{canViewDetails && <Link href="/orders/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"><PlusCircle className="h-4 w-4" /> Tambah Order</Link>}</div>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-4">
        <StatCard title="Order Baru" value={newOrders.length} />
        <StatCard title="Sedang Diproses" value={inProgress.length} />
        <StatCard title="Order Selesai" value={completedOrders.length} />
        <StatCard title="Terlambat" value={overdueOrders.length} attention />
      </div>
      <ProductionFlow selectedStage={stage} onSelectStage={setStage} />
      <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input suppressHydrationWarning type="search" aria-label="Cari SPK atau nama customer" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari SPK / Nama Customer..." className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
      <div id="dashboard-orders" className="scroll-mt-20">
        <OrderTable canViewDetails={canViewDetails} title="Order di Board" headerAction={filterDropdown} orders={visibleOrders} emptyMessage={search ? 'Order tidak ditemukan.' : 'Tidak ada order di tahap ini.'} />
      </div>
    </div>
  )
}
