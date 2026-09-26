'use client'

import { Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { OrderTimer } from '@/components/production-timers'
import OrderPhoto from '@/components/order-photo'
import { AlertTriangle, CheckCircle2, Circle, Loader2, Pencil, Trash2 } from 'lucide-react'
import { PROCESS_STAGES } from '@/lib/process-metrics'
import { deleteOrder, useAllOrders, useProcessHistory, BOARD_STAGE_META } from '@/lib/production-board'
import { StatusBadge, CustomerTypeBadge } from '@/components/ui/badges'
import { formatDate, formatDueDate, isOverdue } from '@/lib/utils'
import { cn } from '@/lib/utils'

const STEP_COLORS: Record<string, string> = {
  ORDER_IN: 'slate', DESIGN: 'red', DESIGN_DONE: 'blue', PRINTING: 'amber', PRESS: 'violet', DONE: 'emerald', ARCHIVE: 'slate',
}

export default function OrderDetailPage() {
  return <Suspense fallback={<p className="text-sm text-slate-500">Memuat detail order...</p>}><OrderDetail /></Suspense>
}

function OrderDetail() {
  const { id } = useParams()
  const router = useRouter()
  const from = useSearchParams().get('from')
  const backHref = from && ['dashboard', 'schedule', 'archives', 'orders'].includes(from)
    ? `/${from}`
    : '/dashboard'
  const order = useAllOrders().find(o => o.id === id)
  const history = useProcessHistory().filter(event => event.orderId === id)

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
    if (!window.confirm(`Hapus order ${order?.spk_code}? Tindakan ini akan menghilangkan order dari seluruh halaman.`)) return
    try { await deleteOrder(String(id)); router.replace(backHref) } catch { /* Connection banner displays the error. */ }
  }

  return (
    <div className="space-y-5 max-w-5xl">
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
          <h2 className="break-words text-xl font-semibold text-slate-900">{order.customer.name}</h2>
          <CustomerTypeBadge customerType={order.customer_type} />
          {overdue && (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Terlambat
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.board_stage !== 'archive' && <><Link href={`/orders/${order.id}/edit`} className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100"><Pencil className="h-3.5 w-3.5" /> Edit Order</Link>
          <button type="button" onClick={handleDelete} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /> Hapus Order</button></>}
          <StatusBadge stepCode={order.current_step.code} stepName={order.current_step.name} colorToken={STEP_COLORS[order.current_step.code]} />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Left: Order Info + Timeline */}
        <div className="min-w-0 space-y-5">
          {/* Info Cards */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Informasi Order</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs text-slate-400">Catatan</p>
                  <p className="text-sm text-slate-700">{order.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Production Timeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Timeline Produksi</h3>
            <div className="space-y-0">
              {PROCESS_STAGES.map((stage, idx) => {
                const step = BOARD_STAGE_META[stage]
                const completed = stage === 'archive' ? !!order.archive?.finalizedAt : history.some(event => event.stage === stage && event.kind === 'completed')
                const skipped = idx < PROCESS_STAGES.indexOf(order.board_stage) && !history.some(event => event.stage === stage)
                const state = completed ? 'completed' : order.board_stage === stage ? 'active' : skipped ? 'skipped' : 'pending'
                const isLast = idx === PROCESS_STAGES.length - 1
                return (
                  <div key={step.code} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full border-2 flex-shrink-0 z-10',
                        state === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white' :
                        state === 'active' ? 'border-brand-500 bg-brand-50 text-brand-600' :
                        'border-slate-200 bg-white text-slate-300'
                      )}>
                        {state === 'completed' ? <CheckCircle2 className="h-4 w-4" /> :
                         state === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                         <Circle className="h-4 w-4" />}
                      </div>
                      {!isLast && (
                        <div className={cn('w-0.5 flex-1 min-h-[2rem]', state === 'completed' ? 'bg-emerald-200' : 'bg-slate-100')} />
                      )}
                    </div>
                    <div className="pb-6 min-w-0">
                      <p className={cn('text-sm font-semibold',
                        state === 'completed' ? 'text-emerald-700' :
                        state === 'active' ? 'text-brand-700' :
                        'text-slate-400'
                      )}>
                        {step.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {state === 'completed' ? 'Selesai' :
                         state === 'active' ? 'Sedang berjalan' : state === 'skipped' ? 'Tidak dilalui / tidak tercatat' :
                         'Menunggu'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Foto order">
          <h3 className="text-sm font-semibold text-slate-900">Foto Order</h3>
          {order.photo_path ? <OrderPhoto orderId={order.id} spkCode={order.spk_code} path={order.photo_path} editable={false} /> : <p className="mt-4 text-sm text-slate-500">Belum ada foto order.</p>}
        </section>
      </div>
      <OrderTimer id={order.id} detail />
    </div>
  )
}
