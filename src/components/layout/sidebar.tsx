'use client'

import { useState } from 'react'
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
  ChevronLeft,
  ChevronRight,
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
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div 
      className={cn(
        "flex h-full flex-col border-r border-slate-200 bg-white flex-shrink-0 transition-all duration-300",
        isCollapsed ? "w-20" : "w-56"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex h-16 items-center border-b border-slate-100",
        isCollapsed ? "justify-center px-0" : "justify-between px-4"
      )}>
        <div className={cn("flex items-center gap-2 overflow-hidden", isCollapsed ? "justify-center" : "")}>
          <Image
            src="/printex-logo.png"
            alt="Logo Printex"
            width={32}
            height={32}
            priority
            className={cn(
              "rounded-lg object-cover shadow-sm flex-shrink-0",
              isCollapsed ? "h-9 w-9" : "h-8 w-8"
            )}
          />
          {!isCollapsed && (
            <div className="whitespace-nowrap">
              <p className="text-sm font-bold text-slate-900 leading-none">Printex</p>
              <p className="text-xs text-slate-400 leading-none mt-0.5">Monitoring</p>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button 
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {/* When collapsed, we can show a button to expand somewhere, e.g. floating or at the top navigation area */}
      {isCollapsed && (
        <div className="flex justify-center pt-2">
          <button 
            onClick={() => setIsCollapsed(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href) && item.href !== '/orders/new')
          return (
            <Link
              key={item.name}
              href={item.href}
              title={isCollapsed ? item.name : undefined}
              className={cn(
                'flex items-center rounded-xl py-2 transition-all',
                isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <item.icon className={cn('h-[19px] w-[19px] flex-shrink-0 transition-colors', isActive ? 'text-blue-600' : 'text-slate-400')} />
              {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User info */}
      <div className="border-t border-slate-100 p-3">
        <div className={cn(
          "flex items-center rounded-xl py-2",
          isCollapsed ? "justify-center px-0" : "gap-3 px-3"
        )}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
            SU
          </div>
          {!isCollapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-xs font-semibold text-slate-900">Super Admin</p>
              <p className="truncate text-xs text-slate-400">superadmin</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
