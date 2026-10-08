'use client'

import Link from 'next/link'

import { BOARD_STAGE_META, useOnlineConnection } from '@/lib/production-board'
import { BOARD_STAGES } from '@/lib/process-metrics'
import { canManageUsers as mayManageUsers } from '@/lib/access-control'
import CustomerServiceSettings from '@/components/customer-service-settings'
import dynamic from 'next/dynamic'

const BranchManagementSettings = dynamic(() => import('@/components/branch-management'))

export default function SettingsPage() {
  const connection = useOnlineConnection()
  const canManageUsers = mayManageUsers(connection.profile?.role)
  return (
    <div className="grid w-full grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
      <div className="min-w-0 space-y-5">
        <CustomerServiceSettings />

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Manajemen User</h3>
          </div>
          {canManageUsers ? <div className="mt-3 flex justify-end"><Link href="/settings/users" className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Kelola Pengguna</Link></div> : <p className="mt-3 text-xs text-slate-500">Hubungi Owner untuk mengelola akun.</p>}
        </div>

      </div>

      {/* Current Production Steps */}
      {connection.profile?.role === 'central_owner' ? <BranchManagementSettings /> : <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Tahapan Produksi Aktif</h3>
        <div className="space-y-2">
          {BOARD_STAGES.map((stage, index) => {
            const step = BOARD_STAGE_META[stage]
            return (
            <div key={step.code} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{index + 1}</span>
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-slate-700">{step.name}</span>
            </div>
          )})}
        </div>
      </div>}
    </div>
  )
}
