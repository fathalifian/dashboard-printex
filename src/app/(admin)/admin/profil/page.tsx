'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import AdminPage from '@/components/admin/admin-page'
import { useOnlineConnection } from '@/lib/production-board'
import { roleLabel } from '@/lib/access-control'

const AccountEditor = dynamic(() => import('@/components/layout/account-editor'))

export default function ProfilePage() {
  const { profile } = useOnlineConnection()
  const [editing, setEditing] = useState(false)
  return <AdminPage section="profil">
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-500">Nama</dt><dd className="mt-0.5 font-medium text-slate-900">{profile?.full_name}</dd></div>
      <div><dt className="text-slate-500">Role</dt><dd className="mt-0.5 font-medium text-slate-900">{roleLabel(profile?.role)}</dd></div>
    </dl>
    <button type="button" disabled={!profile} onClick={() => setEditing(true)} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Ubah nama / password</button>
    {editing && profile && <AccountEditor profile={profile} onClose={() => setEditing(false)} />}
  </AdminPage>
}
