'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { OrderTimer } from '@/components/production-timers'
import { AlertTriangle, Archive, Pencil, PlusCircle, Save, Trash2, X, ZoomIn, ZoomOut, Scan } from 'lucide-react'
import StockShortcuts from '@/components/stock-shortcuts'
import { formatDueDate, isOverdue, cn } from '@/lib/utils'
import { canDragStage, canManageOrders, canMoveBetweenStages, normalizeRole } from '@/lib/access-control'
import { archiveOrder, finishArchivedOrder, deleteOrder, moveOrderToStage, saveOrderPhoto, errorMessage, useProductionOrders, useOnlineConnection, canMoveOrder, type BoardStageId, type DeliveryMethod } from '@/lib/production-board'
import { droppedOrderPhoto, isFileDrop } from '@/lib/order-photo-drop'

type StageId = BoardStageId
type BoardOrder = { id: string; spkCode: string; customer: string; productionType: string; meter: number; customerType: string; dueAt: string; stage: StageId; deliveryMethod?: DeliveryMethod }

const STAGES: Array<{ id: StageId; label: string }> = [
  { id: 'incoming', label: 'Order Masuk' },
  { id: 'design', label: 'Proses Desain' },
  { id: 'design_done', label: 'Menunggu Pembayaran' },
  { id: 'printing', label: 'Proses Sublim' },
  { id: 'press', label: 'Proses Press' },
  { id: 'done', label: 'Order Selesai' },
  { id: 'archive', label: 'Order Diterima Customer' },
]

export default function ProductionBoardPage() {
  const sharedOrders = useProductionOrders()
  const { profile, busy, state: connectionState } = useOnlineConnection()
  const role = profile?.role
  const manageOrders = canManageOrders(role)
  const isOperator = normalizeRole(role) === 'operator'
  const boardViewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [manualZoom, setManualZoom] = useState<number | null>(1)
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
  const [photoDropTarget, setPhotoDropTarget] = useState<string | null>(null)
  const photoUploading = useRef(false)
  useEffect(() => {
    const clearDrag = () => { setDraggedId(null); setDragOverStage(null); setPhotoDropTarget(null) }
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
  const orders: BoardOrder[] = useMemo(() => sharedOrders.map((order) => ({ id: order.id, spkCode: order.spk_code, customer: order.customer.name, productionType: order.production_type, meter: order.meter, customerType: order.customer_type, dueAt: order.due_at, stage: order.board_stage, deliveryMethod: order.archive?.deliveryMethod })), [sharedOrders])

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
    try { if (await moveOrderToStage(orderId, stage)) { setNotice(`${sourceOrder.spkCode} dipindahkan ke ${STAGES.find(item => item.id === stage)?.label}.`) }
    else setNotice('Perpindahan ditolak. Gunakan tahap berikutnya/sebelumnya. Pengecualian: Order Masuk ke Menunggu Pembayaran, atau Sublim ke Selesai khusus DTF.') } catch { setNotice('Perubahan belum tersimpan. Periksa pesan koneksi lalu coba lagi.') }
  }

  function allowedDrop(order: BoardOrder | undefined, stage: StageId) {
    return !!order && canMoveBetweenStages(role, order.stage, stage) && (stage === 'archive' ? manageOrders && order.stage === 'done' : canMoveOrder(order.stage, stage, order.productionType))
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, stage: StageId) {
    event.preventDefault()
    if (isFileDrop(event.dataTransfer)) {
      setPhotoDropTarget(null)
      setNotice('Letakkan foto tepat pada kartu order yang dituju.')
      return
    }
    const orderId = event.dataTransfer.getData('text/plain') || draggedId
    if (orderId) void moveOrder(orderId, stage)
    setDraggedId(null)
    setDragOverStage(null)
  }

  function canUploadPhoto(order: BoardOrder) {
    return manageOrders && order.stage !== 'archive' && connectionState === 'ready' && !busy && !photoUploading.current
  }

  async function dropPhoto(event: DragEvent<HTMLElement>, order: BoardOrder) {
    if (!isFileDrop(event.dataTransfer)) return // Card movement still bubbles to its stage.
    event.preventDefault(); event.stopPropagation(); setPhotoDropTarget(null)
    if (!manageOrders) { setNotice('Hanya Owner/Admin yang dapat mengunggah foto order.'); return }
    if (order.stage === 'archive') { setNotice('Foto order arsip tidak dapat diubah.'); return }
    if (!canUploadPhoto(order)) { setNotice('Tunggu sinkronisasi selesai sebelum mengunggah foto.'); return }
    try {
      const file = droppedOrderPhoto(event.dataTransfer)
      photoUploading.current = true
      setNotice(`Mengoptimalkan dan menyimpan foto ${order.spkCode}...`)
      await saveOrderPhoto(order.id, file)
      setNotice(`Foto ${order.spkCode} tersimpan. Buka Detail Order untuk melihatnya.`)
    } catch (error) { setNotice(errorMessage(error)) }
    finally { photoUploading.current = false }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteOrder(pendingDelete.id); setPendingDelete(null) } catch { setNotice('Order belum dihapus. Periksa pesan koneksi.') }
  }

  return (
    <div className="flex min-h-full flex-col gap-5"
      onDragOver={event => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none' } }}
      onDrop={event => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); setPhotoDropTarget(null); setNotice('Letakkan foto tepat pada kartu order yang dituju.') } }}>
      <div className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1">
        <div role="group" aria-label="Zoom board produksi" className="board-zoom-controls flex shrink-0 flex-nowrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <button type="button" onClick={() => adjustZoom(zoomPercent - 10)} disabled={zoomPercent <= 10} aria-label="Perkecil board" title="Perkecil board" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ZoomOut className="h-4 w-4" /></button>
          <input type="range" min="10" max="150" step="1" value={zoomPercent} onChange={event => adjustZoom(Number(event.target.value))} aria-label="Ukuran board" aria-valuetext={`${zoomPercent} persen`} className="w-20 cursor-pointer accent-brand-600 sm:w-24" />
          <button type="button" onClick={() => adjustZoom(zoomPercent + 10)} disabled={zoomPercent >= 150} aria-label="Perbesar board" title="Perbesar board" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => setManualZoom(1)} aria-label="Reset zoom ke 100 persen" title="Ukuran asli (100%)" className="min-w-12 rounded-lg px-2 py-2 text-xs font-semibold tabular-nums text-slate-600 hover:bg-slate-100">{zoomPercent}%</button>
          <button type="button" onClick={() => { setManualZoom(null); boardViewport.current?.scrollTo({ left: 0 }) }} aria-pressed={manualZoom === null} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold', manualZoom === null ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}><Scan className="h-4 w-4" />Pas layar</button>
        </div>
        <StockShortcuts />
        {manageOrders && <div className="ml-auto flex shrink-0 flex-nowrap items-stretch gap-2 whitespace-nowrap">
          <Link href="/archives" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><Archive className="h-4 w-4" /> Laporan Arsip</Link>
          <Link href="/orders/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"><PlusCircle className="h-4 w-4" /> Tambah Order</Link>
        </div>}
      </div>

      {isOperator && <p className="text-xs leading-5 text-slate-500">Anda dapat memindahkan order di area Menunggu Pembayaran, Sublim, Press, dan Order Selesai. Kolom lainnya hanya untuk dilihat.</p>}
      {notice && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">{notice}</p>}
      <div ref={boardViewport} data-board-viewport tabIndex={0} aria-label="Board produksi, geser untuk melihat seluruh tahap" className="min-w-0 overflow-x-auto pb-3">
        <div data-board-canvas className="grid grid-cols-7 gap-3" style={{ zoom, width: Math.max(1610, viewportWidth / zoom), visibility: viewportWidth ? 'visible' : 'hidden' }}>
          {STAGES.map((stage) => {
            const stageOrders = ordersByStage[stage.id]
            const isTarget = dragOverStage === stage.id
            const movable = canDragStage(role, stage.id)
            return (
              <section key={stage.id} data-board-stage={stage.id} data-movable={movable} className={cn('board-column flex min-h-[560px] flex-col overflow-hidden rounded-2xl border shadow-sm transition-all',  isTarget && 'ring-2 ring-brand-400 ring-offset-2')}>
                <header className="board-column-header flex h-12 items-center justify-between border-b px-3.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-xs font-bold text-slate-800">{stage.label}</h3>
                  </div>
                  <span className="ml-2 flex h-6 min-w-6 items-center justify-center rounded-full border border-black/5 bg-white px-1.5 text-xs font-semibold text-slate-600 shadow-sm">{stageOrders.length}</span>
                </header>

                <div
                  onDragOver={(event) => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; return }; if (!allowedDrop(orders.find(order => order.id === draggedId), stage.id)) { event.dataTransfer.dropEffect = 'none'; return }; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStage(stage.id) }}
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
                        title={manageOrders && stage.id !== 'archive' ? `Seret foto ke kartu ${order.spkCode} untuk menambah atau mengganti foto order` : undefined}
                        draggable={movable}
                        onDragOver={event => {
                          if (!isFileDrop(event.dataTransfer)) return
                          event.preventDefault(); event.stopPropagation()
                          const allowed = canUploadPhoto(order)
                          event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
                          setPhotoDropTarget(allowed ? order.id : null)
                        }}
                        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setPhotoDropTarget(current => current === order.id ? null : current) }}
                        onDrop={event => { void dropPhoto(event, order) }}
                        onDragStart={(event) => { if (!movable) { event.preventDefault(); return }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', order.id); setDraggedId(order.id) }}
                        onDragEnd={() => { setDraggedId(null); setDragOverStage(null) }}
                        className={cn('group relative select-none rounded-2xl border p-3.5 shadow-sm transition-shadow hover:shadow-md', movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default', 'board-card', overdue && 'board-card-overdue', draggedId === order.id && 'scale-95 ring-2 ring-brand-500', photoDropTarget === order.id && 'ring-2 ring-brand-500 ring-offset-2')}
                      >
                        {photoDropTarget === order.id && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/90 p-3 text-center text-xs font-semibold text-brand-700">Lepaskan untuk menyimpan foto</div>}
                        <div className="flex items-start justify-between gap-2 pr-10">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {manageOrders ? <Link draggable={false} href={`/orders/${order.id}?from=schedule`} className="whitespace-nowrap font-mono text-xs font-bold text-brand-700 hover:underline">{order.spkCode}</Link> : <span className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">{order.spkCode}</span>}
                            {order.customerType === 'priority' && <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Prioritas</span>}
                          </div>
                          {manageOrders && stage.id !== 'archive' && <div className="absolute right-3.5 top-3.5 flex flex-col items-center gap-1.5">
                            <Link href={`/orders/${order.id}/edit`} draggable={false} onPointerDown={(event) => event.stopPropagation()} aria-label={`Edit ${order.spkCode}`} title="Edit order" className="board-edit-button"><Pencil className="h-3.5 w-3.5" /></Link>
                            <button type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={() => setPendingDelete(order)} aria-label={`Hapus ${order.spkCode}`} title="Hapus order" className="board-edit-button"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
                            {stage.id === 'done' && <button type="button" draggable={false} onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingArchive(order); setDeliveryMethod('pickup'); setArchiveError('') }} aria-label={`Konfirmasi diterima ${order.spkCode}`} title="Konfirmasi diterima" className="board-edit-button"><Archive className="h-3.5 w-3.5 text-emerald-600" /></button>}
                          </div>}
                          {manageOrders && stage.id === 'archive' && <button type="button" draggable={false} onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingFinish(order); setFinishError('') }} aria-label={`Simpan ${order.spkCode} ke laporan arsip`} title="Simpan ke laporan arsip" className="board-edit-button absolute right-3.5 top-3.5"><Save className="h-3.5 w-3.5 text-brand-600" /></button>}

                        </div>
                        <p title={order.customer} className="mt-2 break-words pr-10 text-sm font-bold leading-5 text-slate-900">{order.customer}</p>
                        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 pr-10 text-xs text-slate-400">
                          <span data-production-type={order.productionType.trim().toLowerCase()} className="board-card-tag rounded-md px-1.5 py-0.5 font-medium">{order.productionType}</span><span>{order.meter} m</span>
                        </div>
                        <p className={cn('mt-2 pr-10 text-[11px] font-medium', overdue ? 'board-due-overdue' : 'text-slate-500')}>Tenggat: {formatDueDate(order.dueAt, completed ? 'completed' : 'active')}</p>
                        <OrderTimer id={order.id} hideTotal={stage.id !== 'archive'} />

                        {stage.id === 'archive' && <><p className="mt-3 text-xs font-medium text-emerald-600">{order.deliveryMethod === 'pickup' ? 'Sudah diambil pembeli' : order.deliveryMethod === 'delivery' ? 'Sudah dikirim / diterima' : 'Penyerahan tercatat'}</p></>}
                      </article>
                    )
                  })}
                  {stageOrders.length === 0 && <div className={cn('board-empty flex flex-1 items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors', isTarget ? 'border-brand-300 bg-brand-50' : 'border-slate-200/80 bg-white/25')}><p className="px-3 text-xs text-slate-400">{manageOrders || movable ? 'Seret order ke sini' : 'Belum ada order'}</p></div>}
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
          <p className="mt-3 text-sm text-slate-500">Order akan dikeluarkan dari board dan disimpan di Laporan Arsip dengan tanggal hari ini. Foto order akan dihapus permanen; data order dan riwayat produksi tetap tersimpan.</p>
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
            }} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{finishing?'Menyimpan...':'Lanjut'}</button>
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
