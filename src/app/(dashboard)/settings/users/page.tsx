'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageUsers, ROLE_LABELS, normalizeRole } from '@/lib/access-control'
import { addManagedUser, deleteManagedUser, listManagedUsers } from './actions'

const ManagedUserEditor = dynamic(() => import('./user-editor'))
const AccountEditor = dynamic(() => import('@/components/layout/account-editor'))

type Account = { id: string; email: string; full_name: string; role: string; is_active: boolean; branch_id?: string }
const empty = { fullName: '', email: '', password: '', role: 'operator', active: true, branchId: '' }
const roles: Record<string,string> = ROLE_LABELS
export default function UsersPage() {
  const connection = useOnlineConnection()
  const [editingSelf, setEditingSelf] = useState(false)
  const [users,setUsers] = useState<Account[]>([])
  const [currentId,setCurrentId] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [editing,setEditing] = useState<Account|null>(null)
  const [form,setForm] = useState({ ...empty, branchId: connection.branchId ?? '' })
  const [removing,setRemoving] = useState<Account|null>(null)
  const allowed = canManageUsers(connection.profile?.role)
  const refresh = useCallback(async()=>{
    try {
      const result=await listManagedUsers(connection.branchId)
      if(result.error){setMessage(result.error);setUsers([])}
      else {setUsers(result.users);setCurrentId(result.currentId)}
    } catch {setMessage('Daftar pengguna belum dapat dimuat. Periksa koneksi internet.')}
    finally {setLoading(false)}
  },[connection.branchId])
  useEffect(()=>{
    let cancelled=false
    void listManagedUsers(connection.branchId).then(result=>{
      if(cancelled)return
      if(result.error){setMessage(result.error);setUsers([])}
      else {setUsers(result.users);setCurrentId(result.currentId)}
    }).catch(()=>{if(!cancelled)setMessage('Daftar pengguna belum dapat dimuat. Periksa koneksi internet.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    const onFocus=()=>{void refresh()}
    window.addEventListener('focus',onFocus)
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')onFocus()},30000)
    return ()=>{cancelled=true;window.removeEventListener('focus',onFocus);window.clearInterval(timer)}
  },[refresh,connection.branchId])
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setMessage('')
    try {
      const result=await addManagedUser({...form,branchId:form.branchId||undefined})
      if(result.error){setMessage(result.error);return}
      setMessage('Akun berhasil dibuat dan dapat digunakan sesuai status aksesnya.')
      setForm({ ...empty, branchId: connection.branchId ?? '' });await refresh()
    } catch {setMessage('Permintaan gagal. Periksa koneksi dan muat ulang daftar akun sebelum mencoba lagi.')}
    finally {setBusy(false);setForm(value=>({...value,password:''}))}
  }
  async function remove() {
    if(!removing)return
    setBusy(true);setMessage('')
    try {
      const result=await deleteManagedUser(removing.id)
      setMessage(result.error||'Akun dihapus. Riwayat order tetap tersimpan.')
      if(!result.error)setRemoving(null)
      await refresh()
    } catch {setMessage('Permintaan gagal. Muat ulang daftar akun dan coba lagi.')}
    finally {setBusy(false)}
  }
  const input='mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900'
  return <div className="max-w-5xl space-y-5">
    <Link href={normalizeRole(connection.profile?.role) === 'operator' ? '/dashboard' : '/settings'} className="text-sm text-brand-600">Kembali</Link>
      {message&&<p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{message}</p>}
      {allowed && <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-4 font-semibold text-slate-900">Tambah Pengguna</h3>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Nama<input required maxLength={100} className={input} value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></label>
          <label className="text-sm text-slate-700">Email<input required type="email" autoComplete="off" className={input} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
          <label className="text-sm text-slate-700">Password awal<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} className={input} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><span className="text-xs text-slate-500">Minimal 8 karakter.</span></label>
          <label className="text-sm text-slate-700">Role<select className={input} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.entries(roles).filter(([value])=>connection.branches && !connection.central ? ['admin','operator'].includes(value) : value!=='central_owner'||connection.central).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {connection.branches && form.role !== 'central_owner' && <label className="text-sm text-slate-700">Cabang<select required className={input} value={form.branchId} onChange={e=>setForm({...form,branchId:e.target.value})}><option value="">Pilih cabang</option>{connection.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox"  checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Akun aktif</label>
          <div className="flex items-center gap-3"><button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Menyimpan...':'Tambah Akun'}</button></div>
        </fieldset>
        <p className="mt-4 text-xs text-slate-500">Owner Pusat memiliki seluruh akses Owner Cabang pada setiap cabang melalui satu akun. Daftar akun mengikuti cabang aktif. Owner Cabang mengelola Admin dan Operator cabangnya. Owner Cabang dan Admin mengelola order serta laporan pada cabang yang ditetapkan. Operator memantau Dashboard dan Board Produksi cabangnya serta menjalankan tahap produksi yang diizinkan.</p>
      </form>}
      {Object.entries(roles).filter(([role]) => {
        const order = Object.keys(roles)
        const viewer = normalizeRole(connection.profile?.role)
        return viewer !== null && order.indexOf(role) >= order.indexOf(viewer)
      }).map(([role, label]) => {
        const accounts = users.filter(user => normalizeRole(user.role) === role)
        return <section key={role} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 p-4 font-semibold text-slate-900">{label} <span className="text-sm font-normal text-slate-500">({accounts.length})</span></h3>
        <table className="w-full min-w-[640px] table-fixed text-left text-sm">
          <colgroup><col className="w-[35%]"/><col className="w-[25%]"/><col className="w-[15%]"/><col className="w-[25%]"/></colgroup>
          <thead className="bg-slate-50 text-slate-500"><tr>{['Pengguna','Role','Status','Aksi'].map(label=><th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>
          {accounts.map(user=><tr key={user.id} className="border-t border-slate-100 align-middle text-slate-700"><td className="p-4"><p className="break-words font-semibold">{user.full_name}{user.id===currentId?' (Anda)':''}</p><p className="break-words text-xs text-slate-500">{user.email}</p></td><td className="p-4">{roles[user.role]||user.role}<p className="text-xs text-slate-500">{connection.branches?.find(branch=>branch.id===user.branch_id)?.name}</p></td><td className="p-4">{user.is_active?'Aktif':'Nonaktif'}</td><td className="p-4"><div className="flex gap-4"><button disabled={busy} onClick={()=>{if(user.id===currentId){setEditingSelf(true);return}setEditing(user);setMessage('')}} className="text-brand-600">Edit</button><button disabled={busy||user.id===currentId} onClick={()=>setRemoving(user)} className="text-red-600 disabled:opacity-30">Hapus</button></div></td></tr>)}
          {!accounts.length&&<tr><td colSpan={4} className="p-8 text-center text-slate-500">{loading?'Memuat akun...':`Belum ada akun ${label}.`}</td></tr>}
        </tbody></table>
      </section>
      })}
      {removing&&<div role="dialog" aria-modal="true" aria-labelledby="delete-user-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-6"><h3 id="delete-user-title" className="font-semibold text-slate-900">Hapus akun {removing.full_name}?</h3><p className="mt-2 text-sm text-slate-600">Pengguna tidak dapat mengakses website lagi. Riwayat order tetap tersimpan.</p>{message&&<p role="alert" className="mt-3 text-sm text-red-600">{message}</p>}<div className="mt-5 flex justify-end gap-4"><button disabled={busy} onClick={()=>setRemoving(null)} className="text-slate-600">Batal</button><button disabled={busy} onClick={()=>void remove()} className="rounded-xl bg-red-600 px-4 py-2 text-white">{busy?'Menghapus...':'Hapus Akun'}</button></div></div></div>}
    {editing && <ManagedUserEditor account={editing} branches={connection.branches} central={connection.central} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setMessage('Akun berhasil diperbarui.'); await refresh() }} />}
    {editingSelf && connection.profile && <AccountEditor profile={connection.profile} onClose={() => { setEditingSelf(false); void refresh() }} />}
  </div>
}
