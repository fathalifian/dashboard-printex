'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import Header from '@/components/layout/header'
import OnlineStatus from '@/components/layout/online-status'
import CustomerServiceProvider from '@/components/layout/customer-service-provider'
import styles from '@/components/layout/workspace.module.css'
import { ADMIN_SECTIONS, canOpenSection } from '@/components/admin/admin-sections'

// Mirrors the dashboard sidebar markup so both areas share one theme.
function AdminSidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname()
  const { profile } = useOnlineConnection()
  const visible = ADMIN_SECTIONS.filter(section => canOpenSection(section, profile?.role))
  const groups = [...new Set(visible.map(section => section.group))]
  return <aside className="workspace-sidebar" data-collapsed={collapsed}>
    <Link href="/admin" className="workspace-brand" aria-label="Pusat Admin - ringkasan">
      <Image src="/printex-brand.jpeg" alt="Logo Printex" width={44} height={44} sizes="44px" loading="eager" className="workspace-brand-logo" />
      <span className="workspace-brand-copy">
        <span className="workspace-brand-name">PRINTEX</span>
        <span className="workspace-brand-subtitle">PUSAT ADMIN</span>
      </span>
    </Link>
    <nav id="workspace-navigation" aria-label="Menu Pusat Admin">
      {groups.map(group => <div key={group}>
        <p className="workspace-nav-group">{group}</p>
        {visible.filter(section => section.group === group).map(section => {
          const Icon = section.icon
          const active = section.href === '/admin' ? pathname === '/admin' : pathname === section.href || pathname.startsWith(section.href + '/')
          return <Link key={section.id} href={section.href} title={section.label} aria-label={section.label} aria-current={active ? 'page' : undefined} className="workspace-nav-link">
            <Icon className="workspace-nav-icon" size={20} aria-hidden="true" /><span className="workspace-nav-label">{section.label}</span>
          </Link>
        })}
      </div>)}
    </nav>
    <div className="workspace-support">
      <Link href="/dashboard" title="Kembali ke Dashboard" aria-label="Kembali ke Dashboard" className="workspace-nav-link !mb-0">
        <ArrowLeft className="workspace-nav-icon" size={20} aria-hidden="true" /><span className="workspace-nav-label">Kembali ke Dashboard</span>
      </Link>
    </div>
  </aside>
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useOnlineConnection()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return <CustomerServiceProvider key={profile?.id}>
    <div className={`${styles.shell} flex h-dvh overflow-hidden bg-[var(--background)]`}>
      <a href="#main-content" className={styles.skipLink}>Langsung ke konten</a>
      <AdminSidebar collapsed={sidebarCollapsed} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed(value => !value)} />
        <main id="main-content" tabIndex={-1} className={`${styles.main} flex-1 overflow-y-auto p-4 sm:p-6`}>
          <div className="w-full"><OnlineStatus>{children}</OnlineStatus></div>
        </main>
      </div>
    </div>
  </CustomerServiceProvider>
}
