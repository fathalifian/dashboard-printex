'use client'

import Link from 'next/link'
import Image from 'next/image'
import { LayoutDashboard, Columns3, ChartNoAxesCombined, Archive, Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useOnlineConnection } from '@/lib/production-board'
import { canAccessPage } from '@/lib/access-control'
import CustomerServiceLink from './customer-service-link'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Board Produksi', href: '/schedule', icon: Columns3 },
  { name: 'Laporan Proses', href: '/reports', icon: ChartNoAxesCombined },
  { name: 'Laporan Arsip', href: '/archives', icon: Archive },
  { name: 'Pengaturan', href: '/settings', icon: Settings },
]

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { profile } = useOnlineConnection()
  const pathname = usePathname()
  return (
    <aside className="workspace-sidebar" data-collapsed={collapsed}>
      <Link href="/dashboard" className="workspace-brand" aria-label="Printex - beranda">
        <Image src="/printex-brand.jpeg" alt="Logo Printex" width={44} height={44} sizes="44px" loading="eager" className="workspace-brand-logo" />
        <span className="workspace-brand-copy">
          <span className="workspace-brand-name">PRINTEX</span>
          <span className="workspace-brand-subtitle">MONITORING SYSTEM</span>
        </span>
      </Link>
      <nav id="workspace-navigation" aria-label="Navigasi utama">
        {navigation.filter(item => canAccessPage(profile?.role, item.href)).map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return <Link key={item.href} href={item.href} title={item.name} aria-label={item.name} aria-current={active ? 'page' : undefined} className="workspace-nav-link"><Icon className="workspace-nav-icon" size={20} aria-hidden="true" /><span className="workspace-nav-label">{item.name}</span></Link>
        })}
      </nav>
      <CustomerServiceLink />
    </aside>
  )
}
