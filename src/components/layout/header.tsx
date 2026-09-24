'use client'

import { LogOut, ChevronDown, Moon, Sun, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useOnlineConnection } from '@/lib/production-board'
import { roleLabel } from '@/lib/access-control'
import { createClient } from '@/lib/supabase/client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Workspace',
  '/orders': 'Semua Order',
  '/orders/new': 'Tambah Order',
  '/schedule': 'Board Produksi',
  '/reports': 'Laporan Proses',
  '/archives': 'Laporan Arsip',
  '/settings': 'Pengaturan',
  '/settings/users': 'Manajemen User',
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener('theme-change', onChange)
  return () => window.removeEventListener('theme-change', onChange)
}

function getTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, () => 'light')
  const isDark = theme === 'dark'

  function toggleTheme() {
    const nextTheme = isDark ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.dataset.theme = nextTheme
    try { localStorage.setItem('printex-theme', nextTheme) } catch { /* Theme still works when storage is unavailable. */ }
    window.dispatchEvent(new Event('theme-change'))
  }

  return (
    <button
      // Browser form extensions can inject fdprocessedid before hydration.
      suppressHydrationWarning
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title={isDark ? 'Mode terang' : 'Mode gelap'}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
    >
      {isDark ? <Sun className="h-[18px] w-[18px] text-amber-400" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  )
}

export default function Header({ sidebarCollapsed, onToggleSidebar }: { sidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const {profile}=useOnlineConnection()
  const pathname = usePathname()
  const [showMenu, setShowMenu] = useState(false)
  const accountMenu = useRef<HTMLDivElement>(null)
  const accountTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showMenu) return
    const outside = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) setShowMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowMenu(false); accountTrigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [showMenu])

  const title = pathname.endsWith('/edit')
    ? 'Edit Order'
    : pathname.startsWith('/orders/') && pathname !== '/orders/new'
    ? 'Detail Order'
    : pageTitles[pathname] ?? 'Printex Monitoring'

  return (
    <header className="workspace-header sticky top-0 z-10 flex h-16 shrink-0 w-full items-center justify-between gap-3 border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <button type="button" className="workspace-sidebar-toggle" onClick={onToggleSidebar} aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation" aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Perkecil sidebar'} title={sidebarCollapsed ? 'Perluas sidebar' : 'Perkecil sidebar'}>
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />

        <div ref={accountMenu} className="relative">
          <button
            // Ignore extension-added attributes on this control only.
            suppressHydrationWarning
            ref={accountTrigger}
            type="button"
            aria-label="Menu akun"
            aria-expanded={showMenu}
            aria-controls="account-menu"
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
              {profile?.full_name.slice(0,2).toUpperCase() ?? '…'}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-slate-900 leading-none">{profile?.full_name ?? 'Akun'}</p>
              <p className="text-xs text-slate-400 leading-none mt-0.5">{roleLabel(profile?.role)}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>

          {showMenu && (
            <div id="account-menu" className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {/* A full navigation clears the in-memory production store on sign-out. */}
              {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
              <button onClick={async()=>{await createClient().auth.signOut();window.location.assign('/login')}} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" />
                Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
