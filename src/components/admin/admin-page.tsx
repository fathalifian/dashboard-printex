'use client'

import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { ADMIN_SECTIONS, canOpenSection, type AdminSectionId } from './admin-sections'

const card = 'min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'

/**
 * One frame for every admin page, using the dashboard's panel pattern
 * (see Produktivitas & kapasitas): icon, title, context line, then content.
 */
export default function AdminPage({ section: id, children, framed = true }: { section: AdminSectionId; children: ReactNode; framed?: boolean }) {
  const { profile } = useOnlineConnection()
  const section = ADMIN_SECTIONS.find(item => item.id === id)!
  const Icon = section.icon
  const header = <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon aria-hidden="true" className="h-5 w-5" /></span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{section.label}</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{section.description}</p>
      </div>
    </div>
  </header>

  if (!canOpenSection(section, profile?.role)) return <section aria-label={section.label} className={card}>{header}
    <p className="flex items-center gap-2 border-t border-slate-100 px-5 py-8 text-sm text-slate-600 sm:px-6"><Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />Menu ini tidak tersedia untuk role Anda.</p>
  </section>
  if (framed) return <section aria-label={section.label} className={card}>{header}
    <div className="border-t border-slate-100 p-5 sm:p-6">{children}</div>
  </section>
  // Panels with their own cards (accounts, CS) follow the header card.
  return <div className="space-y-5">
    <section aria-label={section.label} className={card}>{header}</section>
    {children}
  </div>
}
