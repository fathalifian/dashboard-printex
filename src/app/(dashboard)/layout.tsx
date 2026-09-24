'use client'

import { useState } from 'react'
import Sidebar from '@/components/layout/sidebar'
import Header from '@/components/layout/header'
import OnlineStatus from '@/components/layout/online-status'
import styles from './workspace.module.css'
import CustomerServiceProvider from '@/components/customer-service-provider'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return (
    <CustomerServiceProvider><div className={`${styles.shell} flex h-dvh overflow-hidden bg-[var(--background)]`}>
      <a href="#main-content" className={styles.skipLink}>Langsung ke konten</a>
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed(value => !value)} />
        <main id="main-content" tabIndex={-1} className={`${styles.main} flex-1 overflow-y-auto p-4 sm:p-6`}><OnlineStatus>{children}</OnlineStatus></main>
      </div>
    </div></CustomerServiceProvider>
  )
}
