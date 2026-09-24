'use client'
import { type ReactNode } from 'react'
import { useOnlineConnection } from '@/lib/production-board'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { canAccessPage } from '@/lib/access-control'

export default function OnlineStatus({children}:{children:ReactNode}) {
  const status=useOnlineConnection()
  const pathname = usePathname()
  if (status.state === 'ready' && !canAccessPage(status.profile?.role, pathname)) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"><p>Halaman ini tidak tersedia untuk role Anda.</p><Link href="/dashboard" className="mt-3 inline-block font-medium text-brand-600">Kembali ke Dashboard</Link></div>
  }
  return <>
    {status.busy && <p role="status" className="fixed bottom-5 right-5 z-[60] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">Menyimpan perubahan...</p>}
    {status.error && <div className="mb-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-600" role="alert">
      <p>{status.error}</p>
      {status.state==='error' && <button onClick={()=>window.location.reload()} className="mt-2 font-semibold text-brand-600">Coba kembali</button>}
    </div>}
    {status.state==='loading'?<p className="py-12 text-center text-slate-500">Memuat data...</p>:<div inert={status.busy||status.state==='error'} aria-busy={status.busy} className={status.state==='error'?'opacity-50':undefined}>{children}</div>}
  </>
}
