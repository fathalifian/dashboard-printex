'use client'

import { useMemo, useState } from 'react'
import ReportStatus from '@/components/report-status'
import { useDailySummary, useReportDetails, total } from '@/lib/report-summaries'
import ReportRooms from '@/components/report-rooms'
import DateRangeFilter, { todayRange, type DateRange } from '@/components/date-range-filter'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { useAllOrders, useOnlineConnection } from '@/lib/production-board'
import { jakartaDate } from '@/lib/process-metrics'

function ArchiveDetail({ range, onRangeChange }: { range: DateRange; onRangeChange: (r: DateRange) => void }) {
  const allOrders = useAllOrders()
  const connection = useOnlineConnection()
  const branchMap = useMemo(() => new Map((connection.branches ?? []).map(b => [b.id, b.name])), [connection.branches])
  const branchName = (id?: string) => (id ? branchMap.get(id) : undefined) ?? 'Belum tercatat'
  const orders = useMemo(() => allOrders.filter(order => order.board_stage === 'archive' && order.archive?.finalizedAt), [allOrders])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50
  const saved=useDailySummary(range.start,range.end)
  const details=useReportDetails(range.start,range.end,'archive','',page,query,saved.enabled&&!saved.loading&&!saved.error)

  const periodOrders = useMemo(() => orders.filter(order => order.archive?.finalizedAt && jakartaDate(order.archive.finalizedAt) >= range.start && jakartaDate(order.archive.finalizedAt) <= range.end), [orders, range.start, range.end])
  const filtered = useMemo(() => orders.filter(order => (!query.trim() || `${order.spk_code} ${order.customer.name}`.toLowerCase().includes(query.trim().toLowerCase())) && (order.archive && jakartaDate(order.archive.finalizedAt!) >= range.start && jakartaDate(order.archive.finalizedAt!) <= range.end)).sort((a, b) => (b.archive?.finalizedAt ?? '').localeCompare(a.archive?.finalizedAt ?? '')), [orders, query, range.start, range.end])
  const totalMasuk = useMemo(() => saved.enabled?total(saved.rows,'intake').count:allOrders.filter(order => order.order_date >= range.start && order.order_date <= range.end).length, [allOrders, range.start, range.end,saved.enabled,saved.rows])
  const archiveCount=saved.enabled?total(saved.rows,'archive').count:periodOrders.length
  const resultCount=saved.enabled?details.total:filtered.length

  const totalPages = Math.max(1, Math.ceil(resultCount / pageSize))
  const currentPage = saved.enabled?page:Math.min(page, totalPages)
  const pagedOrders = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize
    return saved.enabled?details.items.flatMap(item=>item.order?[item.order]:[]):filtered.slice(startIdx, startIdx + pageSize)
  }, [filtered, currentPage, pageSize,saved.enabled,details.items])

  function handleQueryChange(text: string) {
    setQuery(text)
    setPage(1)
  }

  function handleRangeChange(newRange: DateRange) {
    onRangeChange(newRange)
    setPage(1)
  }

  if(saved.enabled&&(saved.loading||saved.error))return <div className="space-y-5"><DateRangeFilter value={range} onChange={onRangeChange}/><ReportStatus report={saved}/></div>
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <ReportStatus report={saved} />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Order masuk</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalMasuk}</p>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Selesai dari arsip</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{archiveCount}</p>
        </section>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="min-w-56 flex-1 text-xs font-medium text-slate-500">
          Cari order
          <div className="relative mt-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={query} onChange={event => handleQueryChange(event.target.value)} placeholder="Kode SPK atau nama customer" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900" />
          </div>
        </label>
        <DateRangeFilter value={range} onChange={handleRangeChange} />
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4 text-sm text-slate-500">{resultCount} order ditemukan</div>
        <ReportStatus report={details} />
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{['Cabang', 'Order', 'Customer', 'Produksi', 'Tanggal order', 'Selesai dari arsip', 'Penyerahan', 'Detail'].map(title => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr>
            </thead>
            <tbody>
              {pagedOrders.map(order => (
                <tr key={order.id} className="border-t border-slate-100 text-slate-600">
                  <td className="px-4 py-4">{branchName(order.branch_id)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-900">{order.spk_code}</td>
                  <td className="px-4 py-4">{order.customer.name}</td>
                  <td className="px-4 py-4">{order.production_type} · {order.meter} m</td>
                  <td className="px-4 py-4">{order.order_date}</td>
                  <td className="px-4 py-4">{order.archive ? new Date(order.archive.finalizedAt!).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum tercatat'}</td>
                  <td className="px-4 py-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">Order diterima customer</span></td>
                  <td className="px-4 py-4"><Link href={`/orders/${order.id}?from=archives`} className="font-medium text-brand-600">Lihat order</Link></td>
                </tr>
              ))}
              {!resultCount && <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-400">Tidak ada arsip ditemukan.</td></tr>}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Menampilkan {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, resultCount)} dari {resultCount} order</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Sebelumnya</button>
              <span className="font-medium text-slate-600">Hal {currentPage} dari {totalPages}</span>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Berikutnya</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default function ArchivesPage() {
  const [range, setRange] = useState(todayRange)
  return (
    <ReportRooms kind="archive" range={range} onRangeChange={setRange}>
      <ArchiveDetail range={range} onRangeChange={setRange} />
    </ReportRooms>
  )
}
