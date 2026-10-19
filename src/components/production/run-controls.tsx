'use client'

import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { finishRun, startRun } from '@/lib/production-records'

const elapsed = (since: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} j ${minutes % 60} m` : `${minutes} mnt`
}
// Buttons inside draggable cards must not start a drag.
const stop = { draggable: false, onPointerDown: (event: React.PointerEvent) => event.stopPropagation() }

/** "Mulai cetak" / "Selesai cetak" for an order in Proses Sublim or Proses Press. */
export default function RunControls({ order, stage, openSince, disabled, onError }: {
  order: { id: string; printMachineId?: string | null }
  stage: 'printing' | 'press'; openSince: string | null; disabled: boolean; onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!openSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [openSince])
  const needsMachine = stage === 'printing' && !order.printMachineId
  async function toggle() {
    if (busy) return
    setBusy(true)
    try { if (openSince) await finishRun(order.id); else await startRun(order.id) }
    catch (error) { onError(error instanceof Error ? error.message : 'Belum tersimpan. Coba lagi.') }
    finally { setBusy(false); setNow(Date.now()) }
  }
  return <div className="mt-2 flex items-center gap-1.5">
    <button type="button" {...stop} disabled={disabled || busy || needsMachine} onClick={() => void toggle()} title={needsMachine ? 'Pilih mesin print dulu' : openSince ? 'Selesai cetak: catat waktu mesin berhenti' : 'Mulai cetak: catat waktu mesin mulai'}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-40 ${openSince ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
      {openSince ? <><Square aria-hidden="true" className="h-3 w-3" />Selesai · {elapsed(openSince, now)}</> : <><Play aria-hidden="true" className="h-3 w-3" />Mulai {stage === 'press' ? 'press' : 'cetak'}</>}
    </button>
  </div>
}
