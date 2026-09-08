'use client'
import { type ReactNode } from 'react'
import { useOnlineConnection } from '@/lib/production-board'

export default function OnlineStatus({children}:{children:ReactNode}) {
  const status=useOnlineConnection()
  return <>
    {status.error && <div className="mb-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-600" role="alert">
      <p>{status.error}</p>
      {status.state==='error' && <button onClick={()=>window.location.reload()} className="mt-2 font-semibold text-blue-600">Coba kembali</button>}
    </div>}
    {status.state==='loading'?<p className="py-12 text-center text-slate-500">Memuat data...</p>:<div inert={status.busy||status.state==='error'} aria-busy={status.busy} className={status.state==='error'?'opacity-50':undefined}>{children}</div>}
  </>
}
