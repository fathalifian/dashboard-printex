'use client'

import { selectBranch, useOnlineConnection } from '@/lib/production-board'

export default function BranchSelector() {
 const status = useOnlineConnection()
 if (!status.branches?.length) return null
 return <label className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
   <span className="hidden sm:inline">Cabang</span>
   <select aria-label="Cabang aktif" disabled={status.busy || status.state !== 'ready'}
    value={status.branchId ?? ''} onChange={event => { void selectBranch(event.target.value || null).catch(() => {}) }}
    className="max-w-40 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900">
    {status.central && <option value="">Semua cabang</option>}
    {status.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
   </select>
 </label>
}
