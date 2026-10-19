'use client'

import { Suspense, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { OrderTimer } from '@/components/production/production-timers'
import OrderPhoto from '@/components/orders/order-photo'
import DeleteConfirmation from '@/components/ui/delete-confirmation'
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { deleteOrder, errorMessage, useAllOrders } from '@/lib/production-board'
import { StatusBadge, CustomerTypeBadge } from '@/components/ui/badges'
import { formatDate, formatDueDate, isOverdue } from '@/lib/utils'
import { cn } from '@/lib/utils'


export default function OrderDetailPage() {
  return <Suspense fallback={<p className="text-sm text-slate-500">Memuat detail order...</p>}><OrderDetail /></Suspense>
}

function OrderDetail() {
  const { id } = useParams()
  const router = useRouter()
  const from = useSearchParams().get('from')
  const backHref = from && ['dashboard', 'schedule', 'archives', 'orders', 'reports'].includes(from)
    ? `/${from}`
    : '/dashboard'
  const order = useAllOrders().find(o => o.id === id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletePending = useRef(false)

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-slate-500 text-lg font-medium">Order tidak ditemukan</p>
        <Link href={backHref} className="mt-4 text-brand-600 text-sm hover:underline">Kembali</Link>
      </div>
    )
  }

  const overdue = isOverdue(order.due_at, order.order_state)

  async function handleDelete() {
    if (deletePending.current) return
    deletePending.current = true
    setDeleting(true); setDeleteError('')
    try { await deleteOrder(String(id)); router.replace(backHref) }
    catch (error) { setDeleteError(errorMessage(error)) }
    finally { deletePending.current = false; setDeleting(false) }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          Kembali
        </Link>
        <span className="text-slate-300">/</span>
        <code className="font-mono text-sm font-semibold text-slate-700">{order.spk_code}</code>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="page-title break-words">{order.customer.name}</h2>
          <CustomerTypeBadge customerType={order.customer_type} />
          {overdue && (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Terlambat
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.board_stage !== 'archive' && <><Link href={`/orders/${order.id}/edit`} className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100"><Pencil className="h-3.5 w-3.5" /> Edit Order</Link>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(true) }} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /> Hapus Order</button></>}
          <StatusBadge stepName={order.current_step.name} />
        </div>
      </div>

      <div className="grid flex-1 items-stretch gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Left: order information */}
        <div className="min-w-0 space-y-5">
          {/* Info Cards */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Informasi Order</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
              <div>
                <p className="text-xs text-slate-400">Kode SPK</p>
                <code className="font-mono text-sm font-bold text-slate-900">{order.spk_code}</code>
              </div>
              <div>
                <p className="text-xs text-slate-400">Jenis Produksi</p>
                <p className="text-sm font-medium text-slate-900">{order.production_type}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Jumlah Meter</p>
                <p className="text-sm font-medium text-slate-900">{order.meter} m</p>
              </div>
              {<div><p className="text-xs text-slate-400">Lebar Kertas</p><p className="text-sm font-medium text-slate-900">{order.production_type === 'DTF' ? 'Kertas DTF 0,6 m' : order.paper_width ? order.paper_width.replace('.', ',') + ' m' : 'Belum diisi'}</p></div>}
              <div>
                <p className="text-xs text-slate-400">Tanggal Order</p>
                <p className="text-sm font-medium text-slate-900">{formatDate(order.order_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Due Date</p>
                <p className={cn('text-sm font-medium', overdue ? 'text-red-600' : 'text-slate-900')}>
                  {formatDueDate(order.due_at, order.order_state)}
                </p>
              </div>
              {order.notes && (
                <div className="col-span-full">
                  <p className="text-xs text-slate-400">Catatan</p>
                  <p className="text-sm text-slate-700">{order.notes}</p>
                </div>
              )}
            </div>
          </div>
          <OrderTimer id={order.id} detail />
        </div>
        {/* The photo column stretches to the height of the information column. */}
        <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Foto order">
          <h3 className="text-sm font-semibold text-slate-900">Foto Order</h3>
          {order.photo_path ? <OrderPhoto orderId={order.id} spkCode={order.spk_code} path={order.photo_path} editable={false} />
            : <p className="mt-4 flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-sm text-slate-500">Belum ada foto order.</p>}
        </section>
      </div>
      {confirmDelete && <DeleteConfirmation title="Hapus order?" message={`Order ${order.spk_code} akan dihapus dari seluruh halaman. Tindakan ini tidak dapat dibatalkan.`} busy={deleting} error={deleteError} onCancel={() => setConfirmDelete(false)} onConfirm={() => void handleDelete()} />}
    </div>
  )
}
