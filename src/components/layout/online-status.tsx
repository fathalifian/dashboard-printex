'use client'
import { useState, type ReactNode } from 'react'
import { useOnlineConnection, importLocalData, errorMessage } from '@/lib/production-board'

export default function OnlineStatus({children}:{children:ReactNode}) {
  const status=useOnlineConnection()
  const [message,setMessage]=useState('')
  return <>
    <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{status.busy?'Menyimpan ke database…':status.state==='loading'?'Menghubungkan Supabase…':status.state==='error'?'Koneksi perlu diperiksa':status.realtime?'Online · Realtime aktif':'Online · Menghubungkan realtime (sinkronisasi cadangan setiap 30 detik)'}</span>
        {status.state==='error' && <button onClick={()=>window.location.reload()} className="font-semibold text-blue-600">Coba kembali</button>}
        {status.state==='ready' && ['admin','superadmin'].includes(status.profile?.role??'') && <button disabled={status.busy} onClick={async()=>{try{const count=await importLocalData();setMessage(`${count} order lokal dipindahkan. Riwayat lama tetap tersimpan; impor ulang tidak menggandakan order.`)}catch(error){setMessage(errorMessage(error))}}} className="font-semibold text-blue-600 disabled:opacity-50">Pindahkan data browser lama ke online</button>}
      </div>
      {status.error && <p className="mt-2 text-red-600">{status.error}</p>}
      {message && <p className="mt-2">{message}</p>}
    </div>
    {status.state==='loading'?<p className="py-12 text-center text-slate-500">Memuat data online…</p>:<div inert={status.busy||status.state==='error'} aria-busy={status.busy} className={status.state==='error'?'opacity-50':undefined}>{children}</div>}
  </>
}
