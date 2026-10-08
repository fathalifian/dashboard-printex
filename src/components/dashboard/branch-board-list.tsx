'use client'

import { Building2, ArrowRight } from 'lucide-react'
import { BOARD_STAGE_META, type BoardOrder, type Branch } from '@/lib/production-board'
import { BOARD_STAGES } from '@/lib/process-metrics'

export default function BranchBoardList({ branches, orders, disabled, loading, onOpen }: {
  branches: Branch[]
  orders: BoardOrder[]
  disabled: boolean
  loading: boolean
  onOpen: (id: string) => void
}) {
  return <div className="space-y-5">
    <div><h2 className="page-title">Board produksi per cabang</h2></div>
    {loading ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Memuat board cabang...</p> : <>
      <p className="text-sm text-slate-500">{branches.length} ruang cabang</p>
      <div className="space-y-4">{branches.map(branch => {
        const branchOrders = orders.filter(order => order.branch_id === branch.id)
        return <section key={branch.id} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-brand-50 p-3 text-brand-600"><Building2 className="h-5 w-5" /></span><div><h3 className="break-words text-lg font-semibold text-slate-900">{branch.name}</h3><p className="mt-1 text-xs text-slate-500">{branchOrders.length} order</p></div></div>
            <button type="button" disabled={disabled} onClick={() => onOpen(branch.id)} aria-label={`Buka board produksi ${branch.name}`} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Board Produksi <ArrowRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{BOARD_STAGES.map(stage => <div key={stage} data-board-stage={stage} className="board-column overflow-hidden rounded-lg border"><div className="board-column-header flex h-full flex-col justify-between gap-3 p-3"><span className="text-xs font-medium text-slate-700">{BOARD_STAGE_META[stage].name}</span><span className="text-xl font-semibold tabular-nums text-slate-900">{branchOrders.filter(order => (order.board_stage === 'archive' ? 'done' : order.board_stage) === stage).length}</span></div></div>)}</div>
        </section>
      })}</div>
      {!branches.length && <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Belum ada cabang aktif.</p>}
    </>}
  </div>
}
