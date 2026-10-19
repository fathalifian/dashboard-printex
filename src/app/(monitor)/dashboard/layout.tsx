'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Archive, ChartNoAxesCombined, Columns3, PlusCircle, Settings } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { canAccessPage, canManageOrders } from '@/lib/access-control'
import Header from '@/components/layout/header'
import OnlineStatus from '@/components/layout/online-status'
import CustomerServiceProvider from '@/components/layout/customer-service-provider'
import RoomNavigation from '@/components/layout/room-navigation'
import styles from '@/components/layout/workspace.module.css'
import DateRangeFilter from '@/components/ui/date-range-filter'
import { DashboardProvider, useDashboard } from '@/components/dashboard/dashboard-context'
import type { ProductivityPaperWidth } from '@/lib/productivity'

const PAGES = [
  { name: 'Board Produksi', href: '/schedule', icon: Columns3 },
  { name: 'Laporan Proses', href: '/reports', icon: ChartNoAxesCombined },
  { name: 'Laporan Arsip', href: '/archives', icon: Archive },
  { name: 'Pusat Admin', href: '/admin', icon: Settings },
]

function Brand() {
  const { profile } = useOnlineConnection()
  return <div className="flex min-w-0 items-center gap-4">
    <Link href="/dashboard" aria-label="Dashboard Printex" className="flex shrink-0 items-center gap-2.5">
      <Image src="/printex-brand.jpeg" alt="Logo Printex" width={36} height={36} sizes="36px" loading="eager" className="rounded-lg" />
      <span className="leading-tight"><span className="block text-sm font-bold tracking-wide text-slate-900">PRINTEX</span><span className="block text-[11px] font-semibold tracking-wider text-brand-600">DASHBOARD</span></span>
    </Link>
    <nav aria-label="Halaman lain" className="flex items-center gap-1 border-l border-slate-200 pl-3">
      {PAGES.filter(page => canAccessPage(profile?.role, page.href)).map(page => <Link key={page.href} href={page.href} title={page.name} aria-label={page.name}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"><page.icon aria-hidden="true" className="h-[18px] w-[18px]" /></Link>)}
    </nav>
  </div>
}

function Toolbar() {
  const { range, setRange, start, end, connection, paperWidth, setPaperWidth } = useDashboard()
  return <>
    <DateRangeFilter value={{ ...range, start, end }} onChange={setRange} />
    <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">Lebar
      <select value={paperWidth} onChange={event => setPaperWidth(event.target.value as ProductivityPaperWidth)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700">
        <option value="all">Semua</option>
        {(['1.2', '1.6', '1.8'] as const).map(width => <option key={width} value={width}>{width.replace('.', ',')} m</option>)}
      </select>
    </label>
    {canManageOrders(connection.profile?.role) && <Link href="/orders/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"><PlusCircle aria-hidden="true" className="h-4 w-4" />Tambah Order</Link>}
  </>
}

// The dashboard has its own full-screen page (like Pusat Admin) without the workspace sidebar.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const connection = useOnlineConnection()
  return <><RoomNavigation /><CustomerServiceProvider key={connection.profile?.id}><DashboardProvider>
    <div className={`${styles.shell} flex h-dvh flex-col overflow-hidden bg-[var(--background)]`}>
      <a href="#main-content" className={styles.skipLink}>Langsung ke konten</a>
      <Header leading={<Brand />} actions={<Toolbar />} />
      {/* One fixed screen from laptop width up; smaller screens scroll vertically. */}
      <main id="main-content" tabIndex={-1} className={`${styles.fit} flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:overflow-hidden`}>
        <OnlineStatus className="lg:h-full lg:min-h-0">{children}</OnlineStatus>
      </main>
    </div>
  </DashboardProvider></CustomerServiceProvider></>
}
