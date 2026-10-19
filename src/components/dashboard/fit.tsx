'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Building blocks of the one-screen dashboard: panels fill their grid cell and
 * long lists page through (useFitCount + usePages) instead of scrolling.
 */
export function Panel({ title, icon, aside, className = '', bodyClassName = 'p-3', children }: {
  title: ReactNode; icon?: ReactNode; aside?: ReactNode; className?: string; bodyClassName?: string; children: ReactNode
}) {
  return <section className={`flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white ${className}`}>
    <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-1.5 lg:h-11 lg:flex-nowrap lg:py-0">
      <h2 className="flex min-w-0 shrink-0 items-center gap-2 text-sm font-semibold leading-none text-slate-900">{icon}{title}</h2>
      {aside}
    </header>
    <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>
}

export function Tabs<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (value: T) => void; items: readonly { id: T; label: string; count?: number }[] }) {
  return <div role="group" aria-label={label} className="flex h-8 shrink-0 items-center rounded-lg bg-slate-100 p-0.5">
    {items.map(item => <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold leading-4 ${value === item.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
      {item.label}{item.count !== undefined && <span className="ml-1 font-normal tabular-nums">({item.count})</span>}
    </button>)}
  </div>
}

/** How many fixed-height rows fit in the observed element (the rest go to the next page). */
export function useFitCount(rowHeight: number, reserved = 0) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [count, setCount] = useState(5)
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setCount(Math.max(1, Math.floor((entry.contentRect.height - reserved) / rowHeight))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, rowHeight, reserved])
  return [setElement, count] as const
}

/** Splits items into pages of `size`; the page is clamped when the list or the screen shrinks. */
export function usePages<T>(items: readonly T[], size: number) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(page, pages - 1)
  return { page: current, pages, setPage, visible: items.slice(current * size, current * size + size) }
}

export function Pager({ page, pages, onPage, label, total }: { page: number; pages: number; onPage: (page: number) => void; label: string; total: number }) {
  return <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-3 py-1 text-xs text-slate-500">
    <span>{total} {label}</span>
    {pages > 1 && <nav aria-label={`Halaman ${label}`} className="flex items-center gap-1 text-slate-600">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={`${label} sebelumnya`} className="rounded-md border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" /></button>
      <span className="min-w-9 text-center tabular-nums">{page + 1}/{pages}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label={`${label} berikutnya`} className="rounded-md border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></button>
    </nav>}
  </div>
}

/** Shown instead of empty charts and zero-only figures. */
export function EmptyState({ title, text }: { title: string; text?: string }) {
  return <div role="status" className="flex h-full min-h-32 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 p-4 text-center">
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {text && <p className="max-w-xs text-xs text-slate-500">{text}</p>}
  </div>
}

/** Size of an element, for charts drawn in pixels (crisp markers at any panel size). */
export function useSize() {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, size] as const
}

/** Hover/focus tooltip; the parent needs the `group relative` classes. */
export function Tip({ children, side = 'top' }: { children: ReactNode; side?: 'top' | 'bottom' }) {
  return <span role="tooltip" className={`pointer-events-none absolute left-1/2 z-30 w-max max-w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs font-normal text-slate-700 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}>{children}</span>
}
