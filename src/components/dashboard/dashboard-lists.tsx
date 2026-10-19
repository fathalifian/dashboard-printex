'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, Search } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badges'
import { BOARD_STAGE_META, useProductionOrders, type BoardOrder } from '@/lib/production-board'
import { formatDueDate, isOverdue } from '@/lib/utils'
import { canManageOrders } from '@/lib/access-control'
import { BOARD_STAGES, type ProcessStage } from '@/lib/process-metrics'
import { Pager, useFitCount, usePages } from './fit'
import { useDashboard } from './dashboard-context'

const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortDate = (value: string) => dateFormatter.format(new Date(value + 'T12:00:00Z'))
function duration(ms: number) {
  const hours = Math.floor(ms / 3600000)
  if (hours >= 24) return `${Math.floor(hours / 24)} hari ${hours % 24} jam`
  return hours ? `${hours} jam` : `${Math.max(0, Math.floor(ms / 60000))} menit`
}
// Fixed row heights let useFitCount compute how many rows fit the screen.
const ROW = 44
const HEAD = 30
const box = 'h-72 min-h-0 overflow-hidden lg:h-auto lg:flex-1'

export type AttentionKind = 'late' | 'period' | 'longest'

export function AttentionList({ kind }: { kind: AttentionKind }) {
  const { overdue, dueInPeriod, longest, connection } = useDashboard()
  const [listRef, size] = useFitCount(ROW)
  const canOpen = canManageOrders(connection.profile?.role)
  const items: { order: BoardOrder; note: string }[] = kind === 'late' ? overdue.map(order => ({ order, note: 'Tenggat ' + shortDate(order.due_at) }))
    : kind === 'period' ? dueInPeriod.map(order => ({ order, note: 'Tenggat ' + shortDate(order.due_at) }))
    : longest.map(({ order, milliseconds }) => ({ order, note: duration(milliseconds) }))
  const { page, pages, setPage, visible } = usePages(items, size)
  return <div className="flex h-full min-h-0 flex-col">
    <ul ref={listRef} className={`${box} divide-y divide-slate-100`}>
      {visible.map(({ order, note }) => {
        const content = <>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-slate-900">{order.spk_code}</p>
            <p className="truncate text-xs leading-tight text-slate-500">{order.customer.name} · {BOARD_STAGE_META[order.board_stage].name}</p>
          </div>
          <span className={`flex shrink-0 items-center gap-1 text-xs font-medium ${kind === 'late' ? 'text-red-600' : 'text-slate-600'}`}>{note}{canOpen && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />}</span>
        </>
        return <li key={order.id} style={{ height: ROW }}>
          {canOpen ? <Link href={`/orders/${order.id}?from=dashboard`} className="flex h-full items-center justify-between gap-3 px-3.5 hover:bg-slate-50">{content}</Link>
            : <div className="flex h-full items-center justify-between gap-3 px-3.5">{content}</div>}
        </li>
      })}
      {!items.length && <li className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">{kind === 'late' ? 'Tidak ada order terlambat.' : kind === 'period' ? 'Tidak ada order dengan tenggat pada periode ini.' : 'Belum ada data durasi.'}</li>}
    </ul>
    <Pager page={page} pages={pages} onPage={setPage} label="order" total={items.length} />
  </div>
}

function OrderRows({ orders, canViewDetails, emptyMessage }: { orders: BoardOrder[]; canViewDetails: boolean; emptyMessage: string }) {
  const [boxRef, size] = useFitCount(ROW, HEAD)
  const { page, pages, setPage, visible } = usePages(orders, size)
  return <>
    <div ref={boxRef} className={box}>
      <table className="w-full table-fixed text-left">
        <thead className="bg-slate-50"><tr style={{ height: HEAD }}>
          <th scope="col" className="w-[24%] px-3 text-xs font-semibold text-slate-500">SPK</th>
          <th scope="col" className="px-3 text-xs font-semibold text-slate-500">Customer</th>
          <th scope="col" className="w-[30%] px-3 text-xs font-semibold text-slate-500">Proses</th>
          <th scope="col" className="w-[20%] px-3 text-xs font-semibold text-slate-500">Tenggat</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visible.map(order => {
            const overdue = isOverdue(order.due_at, order.order_state)
            const spk = <code className="truncate font-mono text-xs font-semibold text-slate-900">{order.spk_code}</code>
            return <tr key={order.id} style={{ height: ROW }} className={overdue ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50'}>
              <td className="px-3"><div className="flex min-w-0 items-center gap-1">{overdue && <AlertTriangle aria-label="Terlambat" className="h-3.5 w-3.5 shrink-0 text-red-500" />}{canViewDetails ? <Link href={`/orders/${order.id}?from=dashboard`} className="truncate hover:underline">{spk}</Link> : spk}</div></td>
              <td className="truncate px-3 text-xs font-medium text-slate-900" title={order.customer.name}>{order.customer.name}</td>
              <td className="truncate px-3"><StatusBadge stepName={order.current_step.name} size="sm" /></td>
              <td className={`truncate px-3 text-xs font-medium ${overdue ? 'text-red-600' : 'text-slate-600'}`}>{formatDueDate(order.due_at, order.order_state)}</td>
            </tr>
          })}
          {!orders.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
    <Pager page={page} pages={pages} onPage={setPage} label="order" total={orders.length} />
  </>
}

/** Orders on the board, filtered by search and by the stage chosen here or on the production flow. */
export function OrderList() {
  const { stage, setStage, connection } = useDashboard()
  const orders = useProductionOrders()
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const visibleOrders = useMemo(() => orders.filter(order =>
    (stage === 'all' || (order.board_stage === 'archive' ? 'done' : order.board_stage) === stage) &&
    (!query || order.spk_code.toLowerCase().includes(query) || order.customer.name.toLowerCase().includes(query))
  ), [orders, query, stage])
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 gap-2 border-b border-slate-100 p-2">
      <div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input suppressHydrationWarning type="search" aria-label="Cari SPK atau nama customer" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari SPK / customer..." className="w-full rounded-lg border border-slate-200 bg-white py-1 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
      <select aria-label="Filter tahap order" value={stage} onChange={event => setStage(event.target.value as ProcessStage | 'all')} className="max-w-40 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700">
        <option value="all">Semua tahap</option>
        {BOARD_STAGES.map(id => <option key={id} value={id}>{BOARD_STAGE_META[id].name}</option>)}
      </select>
    </div>
    <OrderRows key={`${stage}:${query}`} orders={visibleOrders} canViewDetails={canManageOrders(connection.profile?.role)} emptyMessage={search ? 'Order tidak ditemukan.' : 'Tidak ada order di tahap ini.'} />
  </div>
}

