'use client'
import { useState, type ReactNode } from 'react'
import { refreshOnlineData, useOnlineConnection } from '@/lib/production-board'
import { createClient } from '@/lib/supabase/client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { canAccessPage } from '@/lib/access-control'
import { LoaderCircle } from 'lucide-react'

export default function OnlineStatus({children}:{children:ReactNode}) {
  const status=useOnlineConnection()
  const [retrying,setRetrying]=useState(false)
  const pathname = usePathname()
  const loading = <div role="status" className="flex items-center justify-center gap-3 py-12 text-slate-500"><LoaderCircle aria-hidden="true" className="size-5 animate-spin"/><span>{status.loadingRows ? `Memuat riwayat... ${status.loadingRows.toLocaleString('id-ID')} baris diterima` : 'Memuat data...'}</span></div>
  async function retryConnection() {
    setRetrying(true)
    try {
      if (status.error?.includes('Sesi login telah berakhir') || status.error?.includes('permission denied for table profiles')) {
        const client = createClient()
        const refreshed = await client.auth.refreshSession()
        if (refreshed.error || !refreshed.data.session) {
          window.location.href = '/login'
          return
        }
      }
      if (!status.lastSyncedAt) window.location.reload()
      else await refreshOnlineData()
    } catch {
      // The shared connection exposes the latest error and keeps writes disabled.
    } finally { setRetrying(false) }
  }
  if (status.state === 'ready' && !canAccessPage(status.profile?.role, pathname)) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"><p>Halaman ini tidak tersedia untuk role Anda.</p><Link href="/dashboard" className="mt-3 inline-block font-medium text-brand-600">Kembali ke Dashboard</Link></div>
  }
  return <>
    {status.busy && <p role="status" className="fixed bottom-5 right-5 z-[60] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">Menyimpan perubahan...</p>}
    {status.error && <div className="mb-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-600" role="alert">
      <p>{status.error}</p>
      {status.state==='error' && (
        <div className="mt-2 flex items-center gap-3">
          <button disabled={retrying} onClick={retryConnection} className="font-semibold text-brand-600 disabled:opacity-50">{retrying?'Menghubungkan...':'Coba kembali'}</button>
          {status.error?.includes('Sesi login telah berakhir') && <Link href="/login" className="font-semibold text-slate-700 underline">Masuk kembali</Link>}
        </div>
      )}
    </div>}
    {status.dataLoading && loading}
    {status.state==='loading'?loading:<div inert={status.busy||status.state==='error'||status.dataLoading} aria-busy={status.busy||status.dataLoading} className={status.dataLoading?'invisible':status.state==='error'?'opacity-50':undefined}>{children}</div>}
  </>
}
