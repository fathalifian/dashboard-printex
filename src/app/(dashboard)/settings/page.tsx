'use client'

import Link from 'next/link'
import { Users } from 'lucide-react'

import { useOnlineConnection } from '@/lib/production-board'
import { canManageUsers as mayManageUsers } from '@/lib/access-control'

export default function SettingsPage() {
  const canManageUsers = mayManageUsers(useOnlineConnection().profile?.role)
  return (
    <div className="space-y-5 max-w-3xl">

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Manajemen User</h3>
          </div>
          <p className="text-xs text-slate-500">Kelola akun dan hak akses.</p>
          {canManageUsers ? <Link href="/settings/users" className="mt-3 inline-block text-sm font-semibold text-blue-600">Kelola Pengguna</Link> : <p className="mt-3 text-xs text-slate-500">Hanya Owner yang dapat mengelola pengguna.</p>}
        </div>

      </div>

      {/* Current Production Steps */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Tahapan Produksi Aktif</h3>
        <div className="space-y-2">
          {[
            { seq: 1, code: 'ORDER_IN', name: 'Order Masuk', color: 'bg-slate-100 text-slate-700' },
            { seq: 2, code: 'DESIGN', name: 'Proses Desain', color: 'bg-red-100 text-red-700' },
            { seq: 3, code: 'DESIGN_DONE', name: 'Menunggu Pembayaran', color: 'bg-blue-100 text-blue-700' },
            { seq: 4, code: 'PRINTING', name: 'Proses Sublim', color: 'bg-amber-100 text-amber-700' },
            { seq: 5, code: 'PRESS', name: 'Proses Press', color: 'bg-violet-100 text-violet-700' },
            { seq: 6, code: 'DONE', name: 'Order Selesai', color: 'bg-emerald-100 text-emerald-700' },
            { seq: 7, code: 'ARCHIVE', name: 'Order Diterima Customer', color: 'bg-slate-200 text-slate-700' },
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
