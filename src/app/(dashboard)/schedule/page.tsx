'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { OrderTimer } from '@/components/production-timers'
import { AlertTriangle, Archive, Check, Palette, Pencil, Printer, Save, Sparkles, Star, Trash2, X, ZoomIn, ZoomOut, Scan } from 'lucide-react'
import { formatDueDate, isOverdue, cn } from '@/lib/utils'
import { canDragStage, canManageOrders, canMoveBetweenStages, normalizeRole } from '@/lib/access-control'
import { archiveOrder, finishArchivedOrder, deleteOrder, moveOrderToStage, useProductionOrders, useOnlineConnection, canMoveOrder, type BoardStageId, type DeliveryMethod } from '@/lib/production-board'

type StageId = BoardStageId
type BoardOrder = { id: string; spkCode: string; customer: string; productionType: string; meter: number; customerType: string; dueAt: string; stage: StageId; deliveryMethod?: DeliveryMethod }

const STAGES: Array<{ id: StageId; label: string; dot: string; icon: typeof Archive; column: string; header: string; drop: string; card: string }> = [
  { id: 'incoming', label: 'Order Masuk', dot: 'bg-slate-500', icon: Sparkles, column: 'border-slate-200 bg-white', header: 'board-neutral-header border-slate-200 bg-slate-50/90', drop: 'border-slate-300 bg-slate-50', card: 'board-card board-card-incoming' },
  { id: 'design', label: 'Proses Desain', dot: 'bg-rose-500', icon: Palette, column: 'border-rose-200 bg-rose-50/70', header: 'border-rose-200 bg-rose-100/80', drop: 'border-rose-300 bg-rose-100/70', card: 'board-card board-card-design' },
  { id: 'design_done', label: 'Menunggu Pembayaran', dot: 'bg-sky-500', icon: Check, column: 'border-sky-200 bg-sky-50/75', header: 'border-sky-200 bg-sky-100/80', drop: 'border-sky-300 bg-sky-100/70', card: 'board-card board-card-design-done' },
  { id: 'printing', label: 'Proses Sublim', dot: 'bg-amber-500', icon: Printer, column: 'border-amber-200 bg-amber-50/80', header: 'border-amber-200 bg-amber-100/85', drop: 'border-amber-300 bg-amber-100/75', card: 'board-card board-card-printing' },
  { id: 'press', label: 'Proses Press', dot: 'bg-violet-500', icon: Printer, column: 'border-violet-200 bg-violet-50/75', header: 'border-violet-200 bg-violet-100/80', drop: 'border-violet-300 bg-violet-100/70', card: 'board-card board-card-press' },
  { id: 'done', label: 'Order Selesai', dot: 'bg-emerald-500', icon: Check, column: 'border-emerald-200 bg-emerald-50/75', header: 'border-emerald-200 bg-emerald-100/80', drop: 'border-emerald-300 bg-emerald-100/70', card: 'board-card board-card-done' },
  { id: 'archive', label: 'Order Diterima Customer', dot: 'bg-slate-500', icon: Archive, column: 'border-slate-200 bg-white', header: 'board-neutral-header border-slate-200 bg-slate-50/90', drop: 'border-slate-300 bg-slate-50', card: 'board-card board-card-archive' },
]

export default function ProductionBoardPage() {
  const sharedOrders = useProductionOrders()
  const { profile } = useOnlineConnection()
  const role = profile?.role
  const manageOrders = canManageOrders(role)
  const isOperator = normalizeRole(role) === 'operator'
  const boardViewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const fitZoom = viewportWidth ? (viewportWidth < 640 ? 1 : Math.min(1, viewportWidth / 1610)) : 1
  const zoom = manualZoom ?? fitZoom
  const zoomPercent = Math.round(zoom * 100)
  const adjustZoom = (percent: number) => setManualZoom(Math.min(150, Math.max(10, percent)) / 100)
  useEffect(() => {
    const viewport = boardViewport.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(Math.max(0, Math.floor(entry.contentRect.width) - 2))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<StageId | null>(null)
  useEffect(() => {
    const clearDrag = () => { setDraggedId(null); setDragOverStage(null) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clearDrag() }
    window.addEventListener('dragend', clearDrag)
    window.addEventListener('drop', clearDrag)
    window.addEventListener('blur', clearDrag)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragend', clearDrag)
      window.removeEventListener('drop', clearDrag)
      window.removeEventListener('blur', clearDrag)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const [pendingDelete, setPendingDelete] = useState<BoardOrder | null>(null)
  const [pendingArchive, setPendingArchive] = useState<BoardOrder | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('pickup')
  const [archiveError, setArchiveError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingFinish, setPendingFinish] = useState<BoardOrder | null>(null)
  const [finishError, setFinishError] = useState('')
  const [finishing, setFinishing] = useState(false)
  const orders: BoardOrder[] = sharedOrders.map((order) => ({ id: order.id, spkCode: order.spk_code, customer: order.customer.name, productionType: order.production_type, meter: order.meter, customerType: order.customer_type, dueAt: order.due_at, stage: order.board_stage, deliveryMethod: order.archive?.deliveryMethod }))

  const ordersByStage = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage.id, orders.filter((order) => order.stage === stage.id)])) as Record<StageId, BoardOrder[]>, [orders])

  async function moveOrder(orderId: string, stage: StageId) {
    const sourceOrder = orders.find(item => item.id === orderId)
    if (!sourceOrder || sourceOrder.stage === stage) return
    if (!canMoveBetweenStages(role, sourceOrder.stage, stage)) { setNotice('Perpindahan ini tidak tersedia untuk role Anda.'); return }
    if (stage === 'archive') {
      const order = orders.find(item => item.id === orderId)
      if (order?.stage === 'done') { setPendingArchive(order); setDeliveryMethod('pickup'); setArchiveError('') }
      else setNotice('Pindahkan order ke Order Selesai terlebih dahulu sebelum mengonfirmasi penyerahan barang.')
      return
    }
    try { if (await moveOrderToStage(orderId, stage)) setNotice('')
    else setNotice('Perpindahan ditolak. Gunakan tahap berikutnya/sebelumnya. Pengecualian: Order Masuk ke Menunggu Pembayaran, atau Sublim ke Selesai khusus DTF.') } catch { setNotice('Perubahan belum tersimpan. Periksa pesan koneksi lalu coba lagi.') }
  }

  function allowedDrop(order: BoardOrder | undefined, stage: StageId) {
    return !!order && canMoveBetweenStages(role, order.stage, stage) && (stage === 'archive' ? manageOrders && order.stage === 'done' : canMoveOrder(order.stage, stage, order.productionType))
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, stage: StageId) {
    event.preventDefault()
    const orderId = event.dataTransfer.getData('text/plain') || draggedId
    if (orderId) void moveOrder(orderId, stage)
    setDraggedId(null)
    setDragOverStage(null)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteOrder(pendingDelete.id); setPendingDelete(null) } catch { setNotice('Order belum dihapus. Periksa pesan koneksi.') }
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Zoom board produksi" className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <button type="button" onClick={() => adjustZoom(zoomPercent - 10)} disabled={zoomPercent <= 10} aria-label="Perkecil board" title="Perkecil board" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ZoomOut className="h-4 w-4" /></button>
          <input type="range" min="10" max="150" step="1" value={zoomPercent} onChange={event => adjustZoom(Number(event.target.value))} aria-label="Ukuran board" aria-valuetext={`${zoomPercent} persen`} className="w-20 cursor-pointer accent-blue-600 sm:w-24" />
          <button type="button" onClick={() => adjustZoom(zoomPercent + 10)} disabled={zoomPercent >= 150} aria-label="Perbesar board" title="Perbesar board" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => setManualZoom(1)} aria-label="Reset zoom ke 100 persen" title="Ukuran asli (100%)" className="min-w-12 rounded-lg px-2 py-2 text-xs font-semibold tabular-nums text-slate-600 hover:bg-slate-100">{zoomPercent}%</button>
          <button type="button" onClick={() => { setManualZoom(null); boardViewport.current?.scrollTo({ left: 0 }) }} aria-pressed={manualZoom === null} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold', manualZoom === null ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100')}><Scan className="h-4 w-4" />Pas layar</button>
        </div>
        {manageOrders && <div className="flex items-stretch gap-2">
          <Link href="/archives" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><Archive className="h-4 w-4" /> Laporan Arsip</Link>
          <Link href="/orders/new" className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700">+ Tambah Order</Link>
        </div>}
      </div>

      {isOperator && <p className="text-xs leading-5 text-slate-500">Anda dapat memindahkan order di area Menunggu Pembayaran, Sublim, Press, dan Order Selesai. Kolom lainnya hanya untuk dilihat.</p>}
      {notice && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</p>}
      <div ref={boardViewport} data-board-viewport tabIndex={0} aria-label="Board produksi, geser untuk melihat seluruh tahap" className="min-w-0 overflow-x-auto pb-3">
        <div data-board-canvas className="grid grid-cols-7 gap-3" style={{ zoom, width: Math.max(1610, viewportWidth / zoom), visibility: viewportWidth ? 'visible' : 'hidden' }}>
          {STAGES.map((stage) => {
            const StageIcon = stage.icon
            const stageOrders = ordersByStage[stage.id]
            const isTarget = dragOverStage === stage.id
            const movable = canDragStage(role, stage.id)
            return (
              <section key={stage.id} data-board-stage={stage.id} data-movable={movable} className={cn('board-column flex min-h-[560px] flex-col overflow-hidden rounded-2xl border shadow-sm transition-all', stage.column, isTarget && 'ring-2 ring-blue-400 ring-offset-2')}>
                <header className={cn('board-column-header flex h-12 items-center justify-between border-b px-3.5', stage.header)}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', stage.dot)} />
                    <StageIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <h3 className="truncate text-xs font-bold text-slate-800">{stage.label}</h3>
                  </div>
                  <span className="ml-2 flex h-6 min-w-6 items-center justify-center rounded-full border border-black/5 bg-white px-1.5 text-xs font-semibold text-slate-600 shadow-sm">{stageOrders.length}</span>
                </header>

                <div
                  onDragOver={(event) => { if (!allowedDrop(orders.find(order => order.id === draggedId), stage.id)) { event.dataTransfer.dropEffect = 'none'; return }; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStage(stage.id) }}
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
                        draggable={movable}
                        onDragStart={(event) => { if (!movable) { event.preventDefault(); return }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', order.id); setDraggedId(order.id) }}
                        onDragEnd={() => { setDraggedId(null); setDragOverStage(null) }}
                        className={cn('group relative select-none rounded-2xl border p-3.5 shadow-sm transition-shadow hover:shadow-md', movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default', stage.card, overdue && 'board-card-overdue', draggedId === order.id && 'scale-95 ring-2 ring-blue-500')}
                      >
                        <div className="flex items-start justify-between gap-2 pr-10">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {manageOrders ? <Link draggable={false} href={`/orders/${order.id}?from=schedule`} className="whitespace-nowrap font-mono text-xs font-bold text-blue-700 hover:underline">{order.spkCode}</Link> : <span className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">{order.spkCode}</span>}
                            {order.customerType === 'priority' && <span title="Customer prioritas" aria-label="Customer prioritas" className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 p-1 text-amber-600"><Star aria-hidden="true" className="h-3 w-3 fill-current" /></span>}
                          </div>
                          {manageOrders && stage.id !== 'archive' && <div className="absolute right-3.5 top-3.5 flex flex-col items-center gap-1.5">
                            <Link href={`/orders/${order.id}/edit`} draggable={false} onPointerDown={(event) => event.stopPropagation()} aria-label={`Edit ${order.spkCode}`} title="Edit order" className="board-edit-button"><Pencil className="h-3.5 w-3.5" /></Link>
                            <button type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={() => setPendingDelete(order)} aria-label={`Hapus ${order.spkCode}`} title="Hapus order" className="board-edit-button"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
                            {stage.id === 'done' && <button type="button" draggable={false} onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingArchive(order); setDeliveryMethod('pickup'); setArchiveError('') }} aria-label={`Konfirmasi diterima ${order.spkCode}`} title="Konfirmasi diterima" className="board-edit-button"><Archive className="h-3.5 w-3.5 text-emerald-600" /></button>}
                          </div>}
                          {manageOrders && stage.id === 'archive' && <button type="button" draggable={false} onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingFinish(order); setFinishError('') }} aria-label={`Simpan ${order.spkCode} ke laporan arsip`} title="Simpan ke laporan arsip" className="board-edit-button absolute right-3.5 top-3.5"><Save className="h-3.5 w-3.5 text-blue-600" /></button>}

                        </div>
                        <p title={order.customer} className="mt-2 break-words pr-10 text-sm font-bold leading-5 text-slate-900">{order.customer}</p>
                        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 pr-10 text-xs text-slate-400">
                          <span className="board-card-tag rounded-md px-1.5 py-0.5 font-medium text-slate-600">{order.productionType}</span><span>{order.meter} m</span>
                        </div>
                        <p className={cn('mt-2 pr-10 text-[11px] font-medium', overdue ? 'board-due-overdue' : 'text-slate-500')}>{overdue && '⚠ '}Due: {formatDueDate(order.dueAt, completed ? 'completed' : 'active')}</p>
                        <OrderTimer id={order.id} hideTotal={stage.id !== 'archive'} />
                        {isOperator && movable && <select aria-label={`Pindahkan ${order.spkCode}`} value={order.stage} onPointerDown={event => event.stopPropagation()} onChange={event => void moveOrder(order.id, event.target.value as StageId)} className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"><option value={order.stage}>Pindahkan ke...</option>{STAGES.filter(target => allowedDrop(order, target.id)).map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select>}
                        {stage.id === 'archive' && <><p className="mt-3 text-xs font-medium text-emerald-600">{order.deliveryMethod === 'pickup' ? 'Sudah diambil pembeli' : order.deliveryMethod === 'delivery' ? 'Sudah dikirim / diterima' : 'Penyerahan tercatat'}</p></>}
                      </article>
                    )
                  })}
                  {stageOrders.length === 0 && <div className={cn('board-empty flex flex-1 items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors', isTarget ? stage.drop : 'border-slate-200/80 bg-white/25')}><p className="px-3 text-xs text-slate-400">{manageOrders || movable ? 'Seret order ke sini' : 'Belum ada order'}</p></div>}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      {pendingArchive && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="archive-order-title" onKeyDown={event => { if (event.key === 'Escape') setPendingArchive(null) }}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 id="archive-order-title" className="text-lg font-bold text-slate-900">Konfirmasi penerimaan order</h3>
          <p className="mt-2 text-sm text-slate-600">{pendingArchive.spkCode} · {pendingArchive.customer}</p>
          <label className="mt-5 block text-sm font-medium text-slate-700">Penyerahan barang<select autoFocus value={deliveryMethod} onChange={event => setDeliveryMethod(event.target.value as DeliveryMethod)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="pickup">Diambil pembeli</option><option value="delivery">Sudah dikirim</option></select></label>
          <p className="mt-3 text-xs leading-5 text-slate-500">Pastikan barang sudah diserahkan. Order akan tampil di kolom Order Diterima Customer. Setelah itu, ikon Simpan menyimpannya ke Laporan Arsip dan mengeluarkannya dari board.</p>
          {archiveError && <p role="alert" className="mt-3 text-sm text-red-600">{archiveError}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPendingArchive(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Batal</button><button type="button" onClick={async () => { try { if (await archiveOrder(pendingArchive.id, deliveryMethod)) setPendingArchive(null); else setArchiveError('Order harus berada di Order Selesai dan belum diarsipkan. Periksa kembali board.'); } catch { setArchiveError('Arsip belum tersimpan. Periksa koneksi database lalu coba lagi.') } }} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Konfirmasi Diterima</button></div>
        </div>
      </div>}

      {pendingFinish && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="finish-order-title" onKeyDown={event => { if(event.key === 'Escape' && !finishing) setPendingFinish(null) }}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 id="finish-order-title" className="text-lg font-bold text-slate-900">Simpan ke laporan arsip?</h3>
          <p className="mt-2 text-sm text-slate-600">{pendingFinish.spkCode} - {pendingFinish.customer}</p>
          <p className="mt-3 text-sm text-slate-500">Order akan dikeluarkan dari board dan disimpan di Laporan Arsip dengan tanggal hari ini.</p>
          {finishError && <p role="alert" className="mt-3 text-sm text-red-600">{finishError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <button autoFocus type="button" disabled={finishing} onClick={() => setPendingFinish(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Batal</button>
            <button type="button" disabled={finishing} onClick={async () => {
              if(finishing)return
              setFinishing(true); setFinishError('')
              try {
                await finishArchivedOrder(pendingFinish.id)
                setNotice(pendingFinish.spkCode + ' tersimpan di Laporan Arsip.')
                setPendingFinish(null)
              } catch {setFinishError('Laporan belum tersimpan. Periksa koneksi dan coba lagi.')}
              finally {setFinishing(false)}
            }} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{finishing?'Menyimpan...':'Lanjut'}</button>
          </div>
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
