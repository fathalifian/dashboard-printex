'use client'

import Link from 'next/link'


import { useOnlineConnection } from '@/lib/production-board'
import { canManageUsers as mayManageUsers } from '@/lib/access-control'
import CustomerServiceSettings from '@/components/customer-service-settings'

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
          <p className="text-xs text-slate-500">Kelola akun dan hak akses.</p>
          {canManageUsers ? <Link href="/settings/users" className="mt-3 inline-block text-sm font-semibold text-brand-600">Kelola Pengguna</Link> : <p className="mt-3 text-xs text-slate-500">Pengelolaan akun dilakukan oleh Owner Pusat atau Owner Cabang.</p>}
        </div>

      </div>

      {/* Current Production Steps */}
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Tahapan Produksi Aktif</h3>
        <div className="space-y-2">
          {[
            { seq: 1, code: 'ORDER_IN', name: 'Order Masuk', color: 'text-slate-700' },
            { seq: 2, code: 'DESIGN', name: 'Proses Desain', color: 'text-slate-700' },
            { seq: 3, code: 'DESIGN_DONE', name: 'Menunggu Pembayaran', color: 'text-slate-700' },
            { seq: 4, code: 'PRINTING', name: 'Proses Sublim', color: 'text-slate-700' },
            { seq: 5, code: 'PRESS', name: 'Proses Press', color: 'text-slate-700' },
            { seq: 6, code: 'DONE', name: 'Order Selesai', color: 'text-slate-700' },
            { seq: 7, code: 'ARCHIVE', name: 'Order Diterima Customer', color: 'text-slate-700' },
          ].map(step => (
            <div key={step.code} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{step.seq}</span>
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${step.color}`}>{step.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
