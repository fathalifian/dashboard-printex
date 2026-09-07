'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ListOrdered,
  CalendarDays,
  Settings,
  ChartColumn,
  Archive,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Board Produksi', href: '/schedule', icon: CalendarDays },
  { name: 'Laporan Proses', href: '/reports', icon: ChartColumn },
  { name: 'Semua Order', href: '/orders', icon: ListOrdered },
  { name: 'Laporan Arsip', href: '/archives', icon: Archive },
  { name: 'Pengaturan', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-56 flex-col border-r border-slate-200 bg-white flex-shrink-0">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-6 border-b border-slate-100">
        <Image
          src="/printex-logo.png"
          alt="Logo Printex"
          width={32}
          height={32}
          priority
          className="h-8 w-8 rounded-lg object-cover shadow-sm"
        />
        <div>
          <p className="text-sm font-bold text-slate-900 leading-none">Printex</p>
          <p className="text-xs text-slate-400 leading-none mt-0.5">Monitoring</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href) && item.href !== '/orders/new')
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <item.icon className={cn('h-[17px] w-[17px] flex-shrink-0', isActive ? 'text-blue-600' : 'text-slate-400')} />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User info */}
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
            SU
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-900">Super Admin</p>
            <p className="truncate text-xs text-slate-400">superadmin</p>
          </div>
        </div>
      </div>
    </div>
  )
}
