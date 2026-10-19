'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import AdminPage from '@/components/admin/admin-page'
import { ADMIN_SECTIONS, canOpenSection, type AdminSectionId } from '@/components/admin/admin-sections'
import { useCustomerService } from '@/components/layout/customer-service-provider'
import { useOnlineConnection } from '@/lib/production-board'
import { roleLabel } from '@/lib/access-control'
import { useMachines } from '@/lib/machines-store'
import { MACHINE_KINDS } from '@/lib/production-machines'

const KIND_SHORT = { fedar: 'Fedar', dtf: 'DTF', press: 'Press' } as const

export default function AdminOverviewPage() {
  const { profile } = useOnlineConnection()
  const contact = useCustomerService()
  const machines = useMachines()
  const status: Partial<Record<AdminSectionId, string>> = {
    akun: 'Owner, Admin & Operator',
    mesin: !machines.loaded ? 'Memuat...' : !machines.available ? 'Jalankan supabase/SETUP.sql'
      : MACHINE_KINDS.map(kind => `${machines.machines.filter(machine => machine.kind === kind).length} ${KIND_SHORT[kind]}`).join(' · '),
    'waktu-kerja': 'Shift, istirahat & setup',
    'link-stok': 'Stock DTF & Kertas · Stock Kain',
    'customer-service': contact.loading ? 'Memuat...' : contact.number ? `+${contact.number}` : 'Belum diisi',
    profil: profile ? `${profile.full_name} · ${roleLabel(profile.role)}` : undefined,
  }
  const sections = ADMIN_SECTIONS.filter(section => section.id !== 'ringkasan' && canOpenSection(section, profile?.role))
  return <AdminPage section="ringkasan" framed={false}>
    <div className="grid gap-3 sm:grid-cols-2">
      {sections.map(section => {
        const Icon = section.icon
        return <Link key={section.id} href={section.href} className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-200 hover:bg-slate-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon aria-hidden="true" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2 font-semibold text-slate-900">{section.label}<ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400 group-hover:text-brand-600" /></span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">{section.description}</span>
            {status[section.id] && <span className="mt-2 block truncate text-xs font-medium text-slate-700">{status[section.id]}</span>}
          </span>
        </Link>
      })}
    </div>
  </AdminPage>
}
