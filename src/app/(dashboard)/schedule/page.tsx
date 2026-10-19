'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { OrderTimer } from '@/components/production/production-timers'
import { AlertTriangle, Archive, Eye, Pencil, PlusCircle, Printer, Search, Trash2, X } from 'lucide-react'
import StockShortcuts from '@/components/production/stock-shortcuts'
import { formatDueDate, isOverdue, cn } from '@/lib/utils'
import { canDragStage, canManageOrders, canMoveBetweenStages } from '@/lib/access-control'
import { archiveOrder, deleteOrder, moveOrderToStage, saveOrderPhoto, setPrintMachine, errorMessage, useProductionOrders, useOnlineConnection, canMoveOrder, type BoardStageId, type DeliveryMethod } from '@/lib/production-board'
import { droppedOrderPhoto, isFileDrop } from '@/lib/order-photo-drop'
import { useMachines } from '@/lib/machines-store'
import { MACHINE_KIND_LABEL, isDtf, printMachineKind, printMachinesFor } from '@/lib/production-machines'
import { useOpenRuns } from '@/lib/production-records'
import RunControls from '@/components/production/run-controls'

type StageId = BoardStageId
type BoardOrder = { id: string; spkCode: string; customer: string; productionType: string; meter: number; customerType: string; dueAt: string; stage: StageId; archived?: boolean; deliveryMethod?: DeliveryMethod; printMachineId?: string | null }

const STAGES: Array<{ id: StageId; label: string }> = [
  { id: 'incoming', label: 'Order Masuk' },
  { id: 'design', label: 'Proses Desain' },
  { id: 'design_done', label: 'Menunggu Pembayaran' },
  { id: 'printing', label: 'Proses Sublim' },
  { id: 'press', label: 'Proses Press' },
  { id: 'done', label: 'Order Selesai' },
]

export default function ProductionBoardPage() {
  return <ProductionBoard />
}

function ProductionBoard() {
  const sharedOrders = useProductionOrders()
  const { profile, busy, state: connectionState } = useOnlineConnection()
  const machineState = useMachines()
  const machineNames = new Map(machineState.machines.map(machine => [machine.id, machine.name]))
  // Mulai/Selesai cetak records machine running time; hidden when the records are unavailable.
  const openRuns = useOpenRuns(true)
  const role = profile?.role
  const manageOrders = canManageOrders(role)
  const boardViewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  // The board always fits the screen width: no zoom controls and no sideways scrolling (phones keep 100%).
  const zoom = viewportWidth ? (viewportWidth < 640 ? 1 : Math.min(1, viewportWidth / 1380)) : 1
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
  const [archiveError, setArchiveError] = useState('')
  const [pendingPrint, setPendingPrint] = useState<{ order: BoardOrder; move: boolean; machineId: string } | null>(null)
  const [printError, setPrintError] = useState('')
  const [notice, setNotice] = useState('')
  const [stagePages, setStagePages] = useState<Partial<Record<StageId, number>>>({})
  const pageSize = 30
  const orders: BoardOrder[] = useMemo(() => sharedOrders.map((order) => ({ id: order.id, spkCode: order.spk_code, customer: order.customer.name, productionType: order.production_type, meter: order.meter, customerType: order.customer_type, dueAt: order.due_at, stage: order.board_stage === 'archive' ? 'done' : order.board_stage, archived: order.board_stage === 'archive' || !!order.archive, deliveryMethod: order.archive?.deliveryMethod, printMachineId: order.print_machine_id ?? null })), [sharedOrders])

  // Search narrows every column to the matching SPK or customer; drag and drop keep working on the results.
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const matches = useMemo(() => query ? orders.filter(order => order.spkCode.toLowerCase().includes(query) || order.customer.toLowerCase().includes(query)) : orders, [orders, query])
  const ordersByStage = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage.id, matches.filter((order) => order.stage === stage.id)])) as Record<StageId, BoardOrder[]>, [matches])
  useEffect(() => {
    if (!query) return
    // Bring the first result into view; columns can be wider than the screen.
    const timer = window.setTimeout(() => boardViewport.current?.querySelector('[data-search-hit]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }), 150)
    return () => window.clearTimeout(timer)
  }, [query])
  function changeSearch(value: string) { setSearch(value); setStagePages({}) }

  async function moveOrder(orderId: string, stage: StageId) {
    const sourceOrder = orders.find(item => item.id === orderId)
    if (!sourceOrder || sourceOrder.stage === stage) return
    if (!canMoveBetweenStages(role, sourceOrder.stage, stage)) { setNotice('Perpindahan ini tidak tersedia untuk role Anda.'); return }
    if (stage === 'archive') {
      const order = orders.find(item => item.id === orderId)
      if (order?.stage === 'done') { setPendingArchive(order); setArchiveError('') }
      else setNotice('Pindahkan order ke Order Selesai terlebih dahulu sebelum mengonfirmasi penyerahan barang.')
      return
    }
    // With machines installed, entering Proses Sublim always records the print machine.
    if (stage === 'printing' && machineState.available) { await choosePrintMachine(sourceOrder, true); return }
    try { if (await moveOrderToStage(orderId, stage)) { setNotice(`${sourceOrder.spkCode} dipindahkan ke ${STAGES.find(item => item.id === stage)?.label}.`) }
    else setNotice('Perpindahan ditolak. Gunakan tahap berikutnya/sebelumnya. Pengecualian: Order Masuk ke Menunggu Pembayaran, atau Sublim ke Selesai khusus DTF.') } catch { setNotice('Perubahan belum tersimpan. Periksa pesan koneksi lalu coba lagi.') }
  }

  async function choosePrintMachine(order: BoardOrder, move: boolean) {
    const candidates = printMachinesFor(machineState.machines, order.productionType)
    if (!candidates.length) { setNotice(`Belum ada mesin ${MACHINE_KIND_LABEL[printMachineKind(order.productionType)]}. Tambahkan di Pusat Admin > Mesin produksi.`); return }
    // A single eligible machine (e.g. one DTF) needs no choice.
    if (move && candidates.length === 1) { await assignPrintMachine(order, candidates[0].id, true); return }
    setPrintError('')
    setPendingPrint({ order, move, machineId: candidates.find(machine => machine.id === order.printMachineId)?.id ?? candidates[0].id })
  }

  async function assignPrintMachine(order: BoardOrder, machineId: string, move: boolean) {
    try {
      if (!await setPrintMachine(order.id, machineId, move)) { setNotice('Perpindahan ke Proses Sublim tidak tersedia dari tahap ini.'); return false }
      setNotice(`${order.spkCode} ${move ? 'dipindahkan ke Proses Sublim' : 'dicetak'} di mesin ${machineNames.get(machineId) ?? 'terpilih'}.`)
      return true
    } catch (error) { const message = errorMessage(error); setNotice(message); setPrintError(message); return false }
  }

  function allowedDrop(order: BoardOrder | undefined, stage: StageId) {
    return !!order && !order.archived && canMoveBetweenStages(role, order.stage, stage) && canMoveOrder(order.stage, stage, order.productionType)
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
    return manageOrders && !order.archived && order.stage !== 'archive' && connectionState === 'ready' && !busy && !photoUploading.current
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
      setNotice(`Foto ${order.spkCode} tersimpan.`)
    } catch (error) { setNotice(errorMessage(error)) }
    finally { photoUploading.current = false }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteOrder(pendingDelete.id); setPendingDelete(null) } catch { setNotice('Order belum dihapus. Periksa pesan koneksi.') }
  }

  return (
    <div className="flex flex-1 flex-col gap-5"
      onDragOver={event => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none' } }}
      onDrop={event => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); setPhotoDropTarget(null); setNotice('Letakkan foto tepat pada kartu order yang dituju.') } }}>
      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
        <div role="search" className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1 max-w-sm">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input suppressHydrationWarning type="search" value={search} onChange={event => changeSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') changeSearch('') }}
              aria-label="Cari SPK atau nama customer di board" placeholder="Cari SPK / customer..." className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 [&::-webkit-search-cancel-button]:hidden" />
            {search && <button type="button" onClick={() => changeSearch('')} aria-label="Hapus pencarian" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {query && <span role="status" className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold', matches.length ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>{matches.length ? `${matches.length} ditemukan` : 'Tidak ada'}</span>}
        </div>
        <StockShortcuts />
        {manageOrders && <div className="ml-auto flex shrink-0 flex-nowrap items-stretch gap-2 whitespace-nowrap">
          <Link href="/archives" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><Archive className="h-4 w-4" /> Laporan Arsip</Link>
          <Link href="/orders/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"><PlusCircle className="h-4 w-4" /> Tambah Order</Link>
        </div>}
      </div>
      {notice && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">{notice}</p>}
      <div ref={boardViewport} data-board-viewport tabIndex={0} aria-label="Board produksi, geser untuk melihat seluruh tahap" className="min-w-0 overflow-x-auto pb-3">
        <div data-board-canvas className="grid grid-cols-6 gap-3" style={{ zoom, width: Math.max(1380, viewportWidth / zoom), visibility: viewportWidth ? 'visible' : 'hidden' }}>
          {STAGES.map((stage) => {
            const stageOrders = ordersByStage[stage.id]
            const totalPages = Math.max(1, Math.ceil(stageOrders.length / pageSize))
            const page = Math.min(stagePages[stage.id] ?? 1, totalPages)
            const visibleOrders = stageOrders.slice((page - 1) * pageSize, page * pageSize)
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
                  {visibleOrders.map((order, index) => {
                    const completed = stage.id === 'done' || stage.id === 'archive'
                    const overdue = isOverdue(order.dueAt, completed ? 'completed' : 'active')
                    return (
                      <article
                        key={order.id}
                        data-search-hit={query && index === 0 ? true : undefined}
                        title={manageOrders && stage.id !== 'archive' ? `Seret foto ke kartu ${order.spkCode} untuk menambah atau mengganti foto order` : undefined}
                        draggable={movable && !order.archived}
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
                        className={cn('group relative select-none rounded-2xl border p-3.5 shadow-sm transition-shadow hover:shadow-md', movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default', 'board-card', overdue && 'board-card-overdue', query && 'ring-2 ring-brand-400', draggedId === order.id && 'scale-95 ring-2 ring-brand-500', photoDropTarget === order.id && 'ring-2 ring-brand-500 ring-offset-2')}
                      >
                        {photoDropTarget === order.id && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/90 p-3 text-center text-xs font-semibold text-brand-700">Lepaskan untuk menyimpan foto</div>}
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <span data-priority={order.customerType === 'priority'} title={order.customerType === 'priority' ? `${order.spkCode} · Customer prioritas` : order.spkCode} className="board-spk block break-all font-mono text-xs font-bold">{order.spkCode}</span>
                            <p title={order.customer} className="mt-2 break-words text-sm font-bold leading-5 text-slate-900">{order.customer}</p>
                            <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-slate-400">
                              <span data-production-type={order.productionType.trim().toLowerCase()} className="board-card-tag rounded-md px-1.5 py-0.5 font-medium">{order.productionType}</span><span>{order.meter} m</span>
                            </div>
                            <p className={cn('mt-2 text-[11px] font-medium', overdue ? 'board-due-overdue' : 'text-slate-500')}>Tenggat: {formatDueDate(order.dueAt, completed ? 'completed' : 'active')}</p>
                            {machineState.available && (stage.id === 'printing'
                              ? <button type="button" draggable={false} disabled={busy || connectionState !== 'ready'} onPointerDown={event => event.stopPropagation()} onClick={() => void choosePrintMachine(order, false)} title={order.printMachineId ? 'Ganti mesin print' : 'Pilih mesin print'} className={cn('mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', order.printMachineId ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200')}><Printer aria-hidden="true" className="h-3 w-3" />{order.printMachineId ? machineNames.get(order.printMachineId) ?? 'Mesin dihapus' : 'Pilih mesin'}</button>
                              : order.printMachineId && (stage.id === 'press' || stage.id === 'done') && <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"><Printer aria-hidden="true" className="h-3 w-3" />{machineNames.get(order.printMachineId) ?? 'Mesin dihapus'}</span>)}
                            {openRuns.available && machineState.available && (stage.id === 'printing' || (stage.id === 'press' && !isDtf(order.productionType))) && !order.archived && <RunControls order={order} stage={stage.id}
                              openSince={openRuns.runs.get(order.id)?.startedAt ?? null} disabled={busy || connectionState !== 'ready'} onError={setNotice} />}
                          </div>
                          {manageOrders && stage.id !== 'archive' && <div className="flex shrink-0 flex-col items-center gap-1.5">
                            <Link href={`/orders/${order.id}?from=schedule`} draggable={false} onPointerDown={event => event.stopPropagation()} aria-label={`Lihat detail ${order.spkCode}`} title="Lihat detail order" className="board-edit-button"><Eye className="h-3.5 w-3.5" /></Link>
                            {!order.archived && <Link href={`/orders/${order.id}/edit`} draggable={false} onPointerDown={(event) => event.stopPropagation()} aria-label={`Edit ${order.spkCode}`} title="Edit order" className="board-edit-button"><Pencil className="h-3.5 w-3.5" /></Link>}
                            {!order.archived && <button type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={() => setPendingDelete(order)} aria-label={`Hapus ${order.spkCode}`} title="Hapus order" className="board-edit-button"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>}
                            {stage.id === 'done' && <button type="button" draggable={false} onPointerDown={event => event.stopPropagation()} onClick={() => { setPendingArchive(order); setArchiveError('') }} aria-label={`Konfirmasi diterima ${order.spkCode}`} title="Masukkan ke arsip" className="board-edit-button"><Archive className="h-3.5 w-3.5 text-emerald-600" /></button>}
                          </div>}

                        </div>
                        <OrderTimer id={order.id} hideTotal={stage.id !== 'done'} />
                      </article>
                    )
                  })}
                  {stageOrders.length === 0 && <div className={cn('board-empty flex flex-1 items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors', isTarget ? 'border-brand-300 bg-brand-50' : 'border-slate-200/80 bg-white/25')}><p className="px-3 text-xs text-slate-400">{query ? 'Tidak ada hasil' : manageOrders || movable ? 'Seret order ke sini' : 'Belum ada order'}</p></div>}
                </div>
                {totalPages > 1 && <nav aria-label={`Halaman ${stage.label}`} className="mt-auto space-y-2 border-t border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                  <p>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, stageOrders.length)} dari {stageOrders.length} order</p>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" disabled={page === 1} onClick={() => setStagePages(pages => ({...pages, [stage.id]: page - 1}))} className="rounded border px-2 py-1 disabled:opacity-40">Sebelumnya</button>
                    <span>{page}/{totalPages}</span>
                    <button type="button" disabled={page === totalPages} onClick={() => setStagePages(pages => ({...pages, [stage.id]: page + 1}))} className="rounded border px-2 py-1 disabled:opacity-40">Berikutnya</button>
                  </div>
                </nav>}
              </section>
            )
          })}
        </div>
      </div>

      {pendingPrint && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="print-machine-title" onKeyDown={event => { if (event.key === 'Escape') setPendingPrint(null) }}>
        <form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onSubmit={async event => { event.preventDefault(); if (await assignPrintMachine(pendingPrint.order, pendingPrint.machineId, pendingPrint.move)) setPendingPrint(null) }}>
          <h3 id="print-machine-title" className="text-lg font-bold text-slate-900">{pendingPrint.move ? 'Pilih mesin print' : 'Ganti mesin print'}</h3>
          <p className="mt-2 text-sm text-slate-600">{pendingPrint.order.spkCode} · {pendingPrint.order.customer} · {pendingPrint.order.productionType} {pendingPrint.order.meter} m</p>
          <fieldset className="mt-5 space-y-2" disabled={busy}>
            <legend className="mb-2 text-xs text-slate-500">{printMachineKind(pendingPrint.order.productionType) === 'dtf' ? 'Bahan DTF hanya dicetak di mesin DTF.' : 'Bahan non-DTF dicetak di mesin Fedar.'}</legend>
            {printMachinesFor(machineState.machines, pendingPrint.order.productionType).map(machine => <label key={machine.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold', pendingPrint.machineId === machine.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
              <input type="radio" name="print-machine" value={machine.id} checked={pendingPrint.machineId === machine.id} onChange={() => setPendingPrint({ ...pendingPrint, machineId: machine.id })} className="accent-brand-600" /><Printer aria-hidden="true" className="h-4 w-4" />{machine.name}
            </label>)}
          </fieldset>
          {printError && <p role="alert" className="mt-3 text-sm text-red-600">{printError}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPendingPrint(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Batal</button><button type="submit" autoFocus disabled={busy} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pendingPrint.move ? 'Pindahkan ke Proses Sublim' : 'Simpan mesin'}</button></div>
        </form>
      </div>}

      {pendingArchive && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="archive-order-title" onKeyDown={event => { if (event.key === 'Escape') setPendingArchive(null) }}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 id="archive-order-title" className="text-lg font-bold text-slate-900">Konfirmasi penerimaan order</h3>
          <p className="mt-2 text-sm text-slate-600">{pendingArchive.spkCode} · {pendingArchive.customer}</p>
          <p className="mt-5 font-medium text-emerald-700">Order diterima customer</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">Konfirmasi barang telah diterima pelanggan.</p>
          {archiveError && <p role="alert" className="mt-3 text-sm text-red-600">{archiveError}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPendingArchive(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Batal</button><button type="button" disabled={busy} onClick={async () => { try { if (await archiveOrder(pendingArchive.id)) setPendingArchive(null); else setArchiveError('Order harus berada di Order Selesai dan belum diarsipkan. Periksa kembali board.'); } catch { setArchiveError('Arsip belum tersimpan. Periksa koneksi database lalu coba lagi.') } }} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Masukkan ke arsip</button></div>
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
