'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageUsers, ROLE_LABELS, normalizeRole } from '@/lib/access-control'
import { addManagedUser, deleteManagedUser, listManagedUsers, updateManagedUser } from './actions'

type Account = { id: string; email: string; full_name: string; role: string; is_active: boolean }
const empty = { fullName: '', email: '', password: '', role: 'operator', active: true }
const roles: Record<string,string> = ROLE_LABELS
export default function UsersPage() {
  const connection = useOnlineConnection()
  const [users,setUsers] = useState<Account[]>([])
  const [currentId,setCurrentId] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [editing,setEditing] = useState<string|null>(null)
  const [form,setForm] = useState(empty)
  const [removing,setRemoving] = useState<Account|null>(null)
  const allowed = canManageUsers(connection.profile?.role)
  const refresh = useCallback(async()=>{
    try {
      const result=await listManagedUsers()
      if(result.error){setMessage(result.error);setUsers([])}
      else {setUsers(result.users);setCurrentId(result.currentId)}
    } catch {setMessage('Daftar pengguna belum dapat dimuat. Periksa koneksi internet.')}
    finally {setLoading(false)}
  },[])
  useEffect(()=>{
    if(!allowed)return
    let cancelled=false
    void listManagedUsers().then(result=>{
      if(cancelled)return
      if(result.error){setMessage(result.error);setUsers([])}
      else {setUsers(result.users);setCurrentId(result.currentId)}
    }).catch(()=>{if(!cancelled)setMessage('Daftar pengguna belum dapat dimuat. Periksa koneksi internet.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    const onFocus=()=>{void refresh()}
    window.addEventListener('focus',onFocus)
    const timer=window.setInterval(onFocus,30000)
    return ()=>{cancelled=true;window.removeEventListener('focus',onFocus);window.clearInterval(timer)}
  },[allowed,refresh])
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setMessage('')
    try {
      const result=editing?await updateManagedUser(editing,{fullName:form.fullName,role:form.role,active:form.active}):await addManagedUser(form)
      if(result.error){setMessage(result.error);return}
      setMessage(editing?'Akun berhasil diperbarui.':'Akun berhasil dibuat dan dapat digunakan sesuai status aksesnya.')
      setEditing(null);setForm(empty);await refresh()
    } catch {setMessage('Permintaan gagal. Periksa koneksi dan muat ulang daftar akun sebelum mencoba lagi.')}
    finally {setBusy(false);setForm(value=>({...value,password:''}))}
  }
  async function remove() {
    if(!removing)return
    setBusy(true);setMessage('')
    try {
      const result=await deleteManagedUser(removing.id)
      setMessage(result.error||'Akun dihapus. Riwayat order tetap tersimpan.')
      if(!result.error){setRemoving(null);setEditing(null);setForm(empty)}
      await refresh()
    } catch {setMessage('Permintaan gagal. Muat ulang daftar akun dan coba lagi.')}
    finally {setBusy(false)}
  }
  const input='mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900'
  return <div className="max-w-5xl space-y-5">
    <Link href="/settings" className="text-sm text-blue-600">Pengaturan</Link>
    {!allowed?<p className="text-slate-500">Hanya Owner yang dapat mengelola akun.</p>:<>
      {message&&<p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{message}</p>}
      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-4 font-semibold text-slate-900">{editing?'Edit Pengguna':'Tambah Pengguna'}</h3>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Nama<input required maxLength={100} className={input} value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></label>
          {!editing&&<><label className="text-sm text-slate-700">Email<input required type="email" autoComplete="off" className={input} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
          <label className="text-sm text-slate-700">Password awal<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} className={input} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><span className="text-xs text-slate-500">Minimal 8 karakter.</span></label></>}
          <label className="text-sm text-slate-700">Role<select disabled={editing===currentId} className={input} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.entries(roles).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" disabled={editing===currentId} checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Akun aktif</label>
          <div className="flex items-center gap-3"><button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Menyimpan...':editing?'Simpan Perubahan':'Tambah Akun'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(empty)}} className="text-sm text-slate-600">Batal</button>}</div>
        </fieldset>
        <p className="mt-4 text-xs text-slate-500">Owner mengelola akun dan seluruh operasional. Admin mengelola order dan laporan. Operator melihat Dashboard dan Board Produksi, serta memindahkan order di area Menunggu Pembayaran, Sublim, Press, dan Order Selesai.</p>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Pengguna','Role','Status','Aksi'].map(label=><th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>
          {users.map(user=><tr key={user.id} className="border-t border-slate-100 text-slate-700"><td className="p-4"><p className="font-semibold">{user.full_name}{user.id===currentId?' (Anda)':''}</p><p className="text-xs text-slate-500">{user.email}</p></td><td className="p-4">{roles[user.role]||user.role}</td><td className="p-4">{user.is_active?'Aktif':'Nonaktif'}</td><td className="p-4"><div className="flex gap-4"><button disabled={busy} onClick={()=>{setEditing(user.id);setForm({fullName:user.full_name,email:user.email,password:'',role:normalizeRole(user.role) ?? 'operator',active:user.is_active});setMessage('')}} className="text-blue-600">Edit</button><button disabled={busy||user.id===currentId} onClick={()=>setRemoving(user)} className="text-red-600 disabled:opacity-30">Hapus</button></div></td></tr>)}
          {!users.length&&<tr><td colSpan={4} className="p-8 text-center text-slate-500">{loading?'Memuat akun...':'Tidak ada akun yang dapat ditampilkan.'}</td></tr>}
        </tbody></table>
      </div>
      {removing&&<div role="dialog" aria-modal="true" aria-labelledby="delete-user-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-6"><h3 id="delete-user-title" className="font-semibold text-slate-900">Hapus akun {removing.full_name}?</h3><p className="mt-2 text-sm text-slate-600">Pengguna tidak dapat mengakses website lagi. Riwayat order tetap tersimpan.</p>{message&&<p role="alert" className="mt-3 text-sm text-red-600">{message}</p>}<div className="mt-5 flex justify-end gap-4"><button disabled={busy} onClick={()=>setRemoving(null)} className="text-slate-600">Batal</button><button disabled={busy} onClick={()=>void remove()} className="rounded-xl bg-red-600 px-4 py-2 text-white">{busy?'Menghapus...':'Hapus Akun'}</button></div></div></div>}
    </>}
  </div>
}
