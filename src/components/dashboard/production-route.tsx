'use client'

import { useRef, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight, Handshake, Layers, PackageCheck, PackagePlus, PenTool, Printer, Wallet } from 'lucide-react'
import type { ProcessStage } from '@/lib/process-metrics'

export type ProductionRouteStop = {
  stage: ProcessStage
  name: string
  count: number
  average: string
  waiting: string
  samples: number
  bottleneck: boolean
  piling: boolean
}

const STATION_ICONS = { incoming: PackagePlus, design: PenTool, design_done: Wallet, printing: Printer, press: Layers, done: PackageCheck, archive: Handshake }

export default function ProductionRoute({ stops, selectedStage, onSelectStage }: {
  stops: ProductionRouteStop[]
  selectedStage: ProcessStage | 'all'
  onSelectStage: (stage: ProcessStage | 'all') => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selected = stops.find(stop => stop.stage === selectedStage)

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = Math.min(stops.length - 1, index + 1)
    else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = stops.length - 1
    else return
    event.preventDefault()
    buttons.current[next]?.focus({ preventScroll: true })
    buttons.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function scrollRoute(direction: number) {
    viewport.current?.scrollBy({ left: direction * 300, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }

  return <div className="production-route">
      <div className="production-route-scroll-controls" role="group" aria-label="Geser jalur produksi">
        <button type="button" onClick={() => scrollRoute(-1)} aria-label="Geser ke tahap awal"><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => scrollRoute(1)} aria-label="Geser ke tahap akhir"><ArrowRight size={16} /></button>
      </div>
    <p id="production-route-help" className="sr-only">Pilih titik untuk memfilter order. Pilih ulang titik aktif untuk menampilkan semua tahap. Gunakan panah kiri dan kanan untuk berpindah titik, lalu Enter atau spasi untuk memilih. Jalur dapat digeser pada layar kecil.</p>
    <div ref={viewport} className="production-route-viewport" role="region" aria-label="Jalur tujuh tahap produksi" aria-describedby="production-route-help" tabIndex={0}>
      <ol className="production-route-track">
        {stops.map((stop, index) => {
          const Icon = STATION_ICONS[stop.stage]
          const active = selectedStage === stop.stage
          return <li key={stop.stage} className="production-route-stop" data-route-stage={stop.stage} data-selected={active}>
            <button ref={element => { buttons.current[index] = element }} type="button" className="production-route-station" aria-label={`Tampilkan order ${stop.name}`} aria-pressed={active} aria-controls="dashboard-orders" onClick={() => onSelectStage(active ? 'all' : stop.stage)} onKeyDown={event => moveFocus(event, index)}>
              <span className="production-route-sign">
                <span className="production-route-stage-name">{stop.name}</span>
                <span className="production-route-landmark" aria-hidden="true"><Icon size={32} strokeWidth={1.6} /></span>
              </span>
              <span className="production-route-node" aria-hidden="true">{index + 1}</span>
              <span className="production-route-count"><strong>{stop.count}</strong><span>order</span></span>
              <span className="production-route-selected-label">{active ? 'Ditampilkan' : 'Lihat order'}</span>
            </button>
            <dl className="production-route-metrics" aria-label={`Durasi ${stop.name}`}>
              <div><dt>Rata-rata selesai</dt><dd title={`${stop.samples} proses selesai pada periode terpilih`}>{stop.average}</dd></div>
              <div><dt>Rata-rata berjalan</dt><dd>{stop.waiting}</dd></div>
            </dl>
            {stop.bottleneck && <p className="production-route-warning" title="Durasi melebihi rata-rata historis; minimal 3 proses selesai.">Proses melambat</p>}
            {stop.piling && <p className="production-route-warning">Order menumpuk</p>}
          </li>
        })}
      </ol>
    </div>
    <p role="status" className="sr-only">{selected ? `${selected.name}: ${selected.count} order di tahap ini.` : 'Menampilkan semua tahap.'}</p>
  </div>
}
