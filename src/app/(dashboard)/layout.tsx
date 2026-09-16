import Sidebar from '@/components/layout/sidebar'
import Header from '@/components/layout/header'
import OnlineStatus from '@/components/layout/online-status'
import styles from './workspace.module.css'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={`${styles.shell} flex h-dvh overflow-hidden bg-[var(--background)]`}>
      <a href="#main-content" className={styles.skipLink}>Langsung ke konten</a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main id="main-content" tabIndex={-1} className={`${styles.main} flex-1 overflow-y-auto p-4 sm:p-6`}><OnlineStatus>{children}</OnlineStatus></main>
      </div>
    </div>
  )
}
