import Sidebar from '@/components/layout/sidebar'
import Header from '@/components/layout/header'
import OnlineStatus from '@/components/layout/online-status'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6"><OnlineStatus>{children}</OnlineStatus></main>
      </div>
    </div>
  )
}
