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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useOnlineConnection } from '@/lib/production-board'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Board Produksi', href: '/schedule', icon: CalendarDays },
  { name: 'Laporan Proses', href: '/reports', icon: ChartColumn },
  { name: 'Semua Order', href: '/orders', icon: ListOrdered },
  { name: 'Laporan Arsip', href: '/archives', icon: Archive },
  { name: 'Pengaturan', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  const { profile } = useOnlineConnection()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-slate-200 bg-white flex-shrink-0 transition-all duration-300 ease-in-out',
        collapsed ? 'w-[60px]' : 'w-56'
      )}
    >
      {/* Logo + Toggle */}
      <div className={cn('flex h-16 items-center border-b border-slate-100 flex-shrink-0', collapsed ? 'justify-center px-0' : 'gap-2 px-4')}>
        {!collapsed && (
          <>
            <Image
              src="/printex-logo.png"
              alt="Logo Printex"
              width={32}
              height={32}
              priority
              className="h-8 w-8 rounded-lg object-cover shadow-sm flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 leading-none truncate">Printex</p>
              <p className="text-xs text-slate-400 leading-none mt-0.5 truncate">Monitoring</p>
            </div>
          </>
        )}
        {collapsed && (
          <Image
            src="/printex-logo.png"
            alt="Logo Printex"
            width={32}
            height={32}
            priority
            className="h-8 w-8 rounded-lg object-cover shadow-sm"
          />
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 space-y-0.5 py-4 overflow-y-auto overflow-x-hidden', collapsed ? 'px-1.5' : 'px-3')}>
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href) && item.href !== '/orders/new')
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              className={cn(
                'flex items-center rounded-xl py-2 text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <item.icon className={cn('h-[17px] w-[17px] flex-shrink-0', isActive ? 'text-blue-600' : 'text-slate-400')} />
              {!collapsed && item.name}
            </Link>
          )
        })}
      </nav>

      {/* Toggle button */}
      <div className={cn('border-t border-slate-100 p-2', collapsed ? 'flex justify-center' : '')}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Buka sidebar' : 'Tutup sidebar'}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors w-full',
            collapsed ? 'justify-center px-2' : ''
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
            : <><PanelLeftClose className="h-4 w-4 flex-shrink-0" /><span>Minimize</span></>
          }
        </button>
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
              {profile?.full_name.slice(0, 2).toUpperCase() ?? '…'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-900">{profile?.full_name ?? 'Akun'}</p>
              <p className="truncate text-xs text-slate-400">{profile?.role ?? 'Memuat profil'}</p>
            </div>
          </div>
        </div>
      )}
      {collapsed && (
        <div className="border-t border-slate-100 p-2 flex justify-center">
          <div
            title={profile?.full_name ?? 'Akun'}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold"
          >
            {profile?.full_name.slice(0, 2).toUpperCase() ?? '…'}
          </div>
        </div>
      )}
    </div>
  )
}
