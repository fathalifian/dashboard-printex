'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
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
import { canAccessPage, roleLabel } from '@/lib/access-control'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Board Produksi', href: '/schedule', icon: CalendarDays },
  { name: 'Laporan Proses', href: '/reports', icon: ChartColumn },
  { name: 'Laporan Arsip', href: '/archives', icon: Archive },
  { name: 'Pengaturan', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  const { profile } = useOnlineConnection()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const visibleNavigation = navigation.filter(item => canAccessPage(profile?.role, item.href))

  return (
    <div
      className={cn(
        'workspace-sidebar flex h-full flex-col border-r border-slate-200 bg-white flex-shrink-0',
        collapsed ? 'w-[60px]' : 'w-56'
      )}
    >
      {/* Logo */}
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

      {/* Sidebar control stays near the logo in both sizes. */}
      <div className={cn('shrink-0 pt-3', collapsed ? 'px-1.5' : 'px-3')}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Buka sidebar' : 'Tutup sidebar'}
          aria-label={collapsed ? 'Buka sidebar' : 'Tutup sidebar'}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900',
            collapsed ? 'justify-center px-2' : 'px-3'
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
            : <><PanelLeftClose className="h-4 w-4 flex-shrink-0" /><span>Minimize</span></>
          }
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleNavigation.length)}, minmax(0, 1fr))` }} aria-label="Navigasi utama" className={cn('flex-1 space-y-1 py-3 overflow-y-auto overflow-x-hidden', collapsed ? 'px-1.5' : 'px-3')}>
        {visibleNavigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href) && item.href !== '/orders/new')
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              aria-label={item.name}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'workspace-nav-link flex items-center rounded-xl py-2 text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <item.icon className={cn('h-[17px] w-[17px] flex-shrink-0', isActive ? 'text-blue-600' : 'text-slate-400')} />
              <span className={cn('workspace-nav-label', collapsed && 'hidden')}>{item.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* User info */}
      {!collapsed && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
              {profile?.full_name.slice(0, 2).toUpperCase() ?? '…'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-900">{profile?.full_name ?? 'Akun'}</p>
              <p className="truncate text-xs text-slate-400">{roleLabel(profile?.role)}</p>
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
