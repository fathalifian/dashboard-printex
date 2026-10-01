'use client'

import { useSyncExternalStore } from 'react'

const changed = 'printex-navigation'
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(changed, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(changed, listener)
  }
}
export function useRoomUrl() {
  return useSyncExternalStore(subscribe, () => window.location.href, () => '')
}

export function recordRoomNavigation(branchId: string | null, room: 'all' | null = null, replace = false) {
  if (typeof window === 'undefined' || !window.location?.href || !window.history) return
  const url = new URL(window.location.href)
  url.searchParams.set('branch', branchId ?? 'all')
  if (room === 'all') url.searchParams.set('room', 'all')
  else url.searchParams.delete('room')
  if (url.href === window.location.href) return
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(changed))
}
