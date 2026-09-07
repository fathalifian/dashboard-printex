'use client'

import { useMemo, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { AlertTriangle, Archive, Check, Palette, Pencil, Printer, Sparkles, Star, Trash2, X } from 'lucide-react'
import { formatDueDate, isOverdue, cn } from '@/lib/utils'
import { archiveOrder, finishArchivedOrder, deleteOrder, moveOrderToStage, useProductionOrders, type BoardStageId, type DeliveryMethod } from '@/lib/production-board'

type StageId = BoardStageId
type BoardOrder = { id: string; spkCode: string; customer: string; productionType: string; meter: number; customerType: string; dueAt: string; stage: StageId; deliveryMethod?: DeliveryMethod }

const STAGES: Array<{ id: StageId; label: string; dot: string; icon: typeof Archive; column: string; header: string; drop: string; card: string }> = [
  { id: 'incoming', label: 'Order Masuk', dot: 'bg-slate-500', icon: Sparkles, column: 'border-slate-200 bg-white', header: 'board-neutral-header border-slate-200 bg-slate-50/90', drop: 'border-slate-300 bg-slate-50', card: 'board-card board-card-incoming' },
  { id: 'design', label: 'Proses Design', dot: 'bg-rose-500', icon: Palette, column: 'border-rose-200 bg-rose-50/70', header: 'border-rose-200 bg-rose-100/80', drop: 'border-rose-300 bg-rose-100/70', card: 'board-card board-card-design' },
  { id: 'design_done', label: 'Design Done', dot: 'bg-sky-500', icon: Check, column: 'border-sky-200 bg-sky-50/75', header: 'border-sky-200 bg-sky-100/80', drop: 'border-sky-300 bg-sky-100/70', card: 'board-card board-card-design-done' },
  { id: 'printing', label: 'Proses Cetak', dot: 'bg-amber-500', icon: Printer, column: 'border-amber-200 bg-amber-50/80', header: 'border-amber-200 bg-amber-100/85', drop: 'border-amber-300 bg-amber-100/75', card: 'board-card board-card-printing' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-500', icon: Check, column: 'border-emerald-200 bg-emerald-50/75', header: 'border-emerald-200 bg-emerald-100/80', drop: 'border-emerald-300 bg-emerald-100/70', card: 'board-card board-card-done' },
  { id: 'archive', label: 'Arsip', dot: 'bg-slate-500', icon: Archive, column: 'border-slate-200 bg-white', header: 'board-neutral-header border-slate-200 bg-slate-50/90', drop: 'border-slate-300 bg-slate-50', card: 'board-card board-card-archive' },
]

export default function ProductionBoardPage() {
  const sharedOrders = useProductionOrders()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<StageId | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BoardOrder | null>(null)
  const [pendingArchive, setPendingArchive] = useState<BoardOrder | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('pickup')
  const [archiveError, setArchiveError] = useState('')
  const [notice, setNotice] = useState('')
  const orders: BoardOrder[] = sharedOrders.map((order) => ({ id: order.id, spkCode: order.spk_code, customer: order.customer.name, productionType: order.production_type, meter: order.meter, customerType: order.customer_type, dueAt: order.due_at, stage: order.board_stage, deliveryMethod: order.archive?.deliveryMethod }))

  const ordersByStage = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage.id, orders.filter((order) => order.stage === stage.id)])) as Record<StageId, BoardOrder[]>, [orders])

  function moveOrder(orderId: string, stage: StageId) {
    const sourceOrder = orders.find(item => item.id === orderId)
    if (!sourceOrder || sourceOrder.stage === stage) return
    if (stage === 'archive') {
      const order = orders.find(item => item.id === orderId)
      if (order?.stage === 'done') { setPendingArchive(order); setDeliveryMethod('pickup'); setArchiveError('') }
      else setNotice('Pindahkan order ke Done terlebih dahulu sebelum mengonfirmasi penyerahan barang.')
      return
    }
    if (moveOrderToStage(orderId, stage)) setNotice('')
    else setNotice('Perpindahan ditolak. Order hanya boleh dipindahkan satu tahap ke proses berikutnya atau sebelumnya, tanpa melompati proses.')
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, stage: StageId) {
    event.preventDefault()
    const orderId = event.dataTransfer.getData('text/plain') || draggedId
    if (orderId) moveOrder(orderId, stage)
    setDraggedId(null)
    setDragOverStage(null)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteOrder(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Board Produksi</h2>
          <p className="mt-1 text-sm text-slate-500">Geser order satu tahap ke proses berikutnya atau sebelumnya. Tidak bisa melompati proses.</p>
        </div>
        <div className="flex items-stretch gap-2">
          <Link href="/archives" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><Archive className="h-4 w-4" /> Laporan Arsip</Link>
          <Link href="/orders/new" className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700">+ Tambah Order</Link>
        </div>
      </div>

      {notice && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</p>}
      <div className="overflow-x-auto pb-3">
        <div className="grid min-w-[1320px] grid-cols-6 gap-3">
          {STAGES.map((stage) => {
            const StageIcon = stage.icon
            const stageOrders = ordersByStage[stage.id]
            const isTarget = dragOverStage === stage.id
            return (
              <section key={stage.id} data-board-stage={stage.id} className={cn('board-column flex min-h-[560px] flex-col overflow-hidden rounded-2xl border shadow-sm transition-all', stage.column, isTarget && 'ring-2 ring-blue-400 ring-offset-2')}>
                <header className={cn('board-column-header flex h-12 items-center justify-between border-b px-3.5', stage.header)}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', stage.dot)} />
                    <StageIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <h3 className="truncate text-xs font-bold text-slate-800">{stage.label}</h3>
                  </div>
                  <span className="ml-2 flex h-6 min-w-6 items-center justify-center rounded-full border border-black/5 bg-white px-1.5 text-xs font-semibold text-slate-600 shadow-sm">{stageOrders.length}</span>
                </header>

                <div
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStage(stage.id) }}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStage(null) }}
                  onDrop={(event) => handleDrop(event, stage.id)}
                  className="flex flex-1 flex-col gap-3 p-3"
                >
                  {stageOrders.map((order) => {
                    const completed = stage.id === 'done' || stage.id === 'archive'
                    const overdue = isOverdue(order.dueAt, completed ? 'completed' : 'active')
                    return (
                      <article
                        key={order.id}
                        draggable={stage.id !== 'archive'}
                        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', order.id); setDraggedId(order.id) }}
                        onDragEnd={() => { setDraggedId(null); setDragOverStage(null) }}
                        className={cn('group cursor-grab rounded-2xl border p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing', stage.card, overdue && 'board-card-overdue', draggedId === order.id && 'scale-95 opacity-45')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Link href={`/orders/${order.id}`} className="whitespace-nowrap font-mono text-xs font-bold text-blue-700 hover:underline">{order.spkCode}</Link>
                            {order.customerType === 'priority' && <span title="Customer prioritas" aria-label="Customer prioritas" className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 p-1 text-amber-600"><Star aria-hidden="true" className="h-3 w-3 fill-current" /></span>}
                          </div>
                          {stage.id !== 'archive' && <div className="flex shrink-0 flex-col items-center gap-1.5">
                            <Link href={`/orders/${order.id}/edit`} draggable={false} onPointerDown={(event) => event.stopPropagation()} aria-label={`Edit ${order.spkCode}`} title="Edit order" className="board-edit-button"><Pencil className="h-3.5 w-3.5" /></Link>
                            <button type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={() => setPendingDelete(order)} aria-label={`Hapus ${order.spkCode}`} title="Hapus order" className="board-edit-button"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
                          </div>}
                        </div>
                        <p className="mt-2 truncate text-sm font-bold text-slate-900">{order.customer}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                          <span className="board-card-tag rounded-md px-1.5 py-0.5 font-medium text-slate-600">{order.productionType}</span><span>{order.meter} m</span>
                        </div>
                        <p className={cn('mt-2 text-[11px] font-medium', overdue ? 'board-due-overdue' : 'text-slate-500')}>{overdue && '⚠ '}Due: {formatDueDate(order.dueAt, completed ? 'completed' : 'active')}</p>
                        {stage.id === 'done' && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingArchive(order); setDeliveryMethod('pickup'); setArchiveError('') }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700"><Archive className="h-4 w-4" /> Arsipkan</button>}
                        {stage.id === 'archive' && <><p className="mt-3 text-xs font-medium text-emerald-600">{order.deliveryMethod === 'pickup' ? 'Sudah diambil pembeli' : order.deliveryMethod === 'delivery' ? 'Sudah dikirim / diterima' : 'Penyerahan tercatat'}</p><button type="button" onClick={() => { try { if (finishArchivedOrder(order.id)) setNotice(`${order.spkCode} tersimpan di Laporan Arsip dengan tanggal hari ini (WIB).`); else setNotice('Order sudah diselesaikan atau data penyerahannya belum lengkap.') } catch { setNotice('Laporan belum tersimpan. Periksa penyimpanan browser lalu coba lagi.') } }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"><Check className="h-4 w-4" /> Selesai</button></>}
                      </article>
                    )
                  })}
                  {stageOrders.length === 0 && <div className={cn('board-empty flex flex-1 items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors', isTarget ? stage.drop : 'border-slate-200/80 bg-white/25')}><p className="px-3 text-xs text-slate-400">Seret order ke sini</p></div>}
                </div>
              </section>
            )
          })}
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-400">Order belum selesai tetap tersedia besok. Setelah penyerahan barang, pindahkan Done ke Arsip. Klik Selesai di kartu Arsip untuk mengeluarkannya dari board dan menyimpan Laporan Arsip berdasarkan tanggal klik (WIB).</p>

      {pendingArchive && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="archive-order-title" onKeyDown={event => { if (event.key === 'Escape') setPendingArchive(null) }}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 id="archive-order-title" className="text-lg font-bold text-slate-900">Arsipkan order selesai</h3>
          <p className="mt-2 text-sm text-slate-600">{pendingArchive.spkCode} · {pendingArchive.customer}</p>
          <label className="mt-5 block text-sm font-medium text-slate-700">Penyerahan barang<select autoFocus value={deliveryMethod} onChange={event => setDeliveryMethod(event.target.value as DeliveryMethod)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="pickup">Diambil pembeli</option><option value="delivery">Sudah dikirim</option></select></label>
          <p className="mt-3 text-xs leading-5 text-slate-500">Pastikan barang sudah diserahkan. Order akan tampil di kolom Arsip. Setelah itu, tombol Selesai menyimpannya ke Laporan Arsip dan mengeluarkannya dari board.</p>
          {archiveError && <p role="alert" className="mt-3 text-sm text-red-600">{archiveError}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPendingArchive(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Batal</button><button type="button" onClick={() => { try { if (archiveOrder(pendingArchive.id, deliveryMethod)) setPendingArchive(null); else setArchiveError('Order harus berada di Done dan belum diarsipkan. Periksa kembali board.'); } catch { setArchiveError('Arsip belum tersimpan. Periksa ruang penyimpanan browser lalu coba lagi.') } }} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Simpan ke Arsip</button></div>
        </div>
      </div>}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-order-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <button type="button" onClick={() => setPendingDelete(null)} aria-label="Tutup konfirmasi" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <h3 id="delete-order-title" className="mt-4 text-lg font-bold text-slate-900">Hapus order ini?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              <span className="font-semibold text-slate-900">{pendingDelete.spkCode} — {pendingDelete.customer}</span> akan dihapus dari Board Produksi, Dashboard, dan Semua Order.
            </p>
            <p className="mt-2 text-xs font-medium text-red-600">Tindakan ini tidak dapat dibatalkan.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPendingDelete(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">Batal</button>
              <button type="button" onClick={confirmDelete} autoFocus className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700">
                <Trash2 className="h-4 w-4" /> Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
