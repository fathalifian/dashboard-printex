'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { selectBranch, selectDataView, selectDataOrder, useOnlineConnection } from '@/lib/production-board'
import { recordRoomNavigation, useRoomUrl } from '@/lib/room-navigation'

export default function RoomNavigation() {
  const status = useOnlineConnection()
  const pathname = usePathname()
  const href = useRoomUrl()
  useEffect(() => {
    const id = /^\/orders\/([0-9a-f-]{36})(?:\/edit)?$/i.exec(pathname)?.[1] ?? null
    selectDataOrder(id)
    selectDataView(/^\/(reports|archives|settings)(?:\/|$)/.test(pathname))
  },[pathname])
  useEffect(() => {
    if (!href || status.state !== 'ready' || status.busy || !status.branches?.length) return
    const url = new URL(href)
    const requested = url.searchParams.get('branch')
    if (requested === null) {
      recordRoomNavigation(status.branchId ?? null, null, true)
      return
    }
    const branch = requested === 'all' ? null : requested
    if (branch === null ? !status.central : !status.branches.some(item => item.id === branch)) {
      recordRoomNavigation(status.branchId ?? null, null, true)
      return
    }
    if (branch !== (status.branchId ?? null)) void selectBranch(branch, { history: false }).catch(() => {})
  }, [href, pathname, status])
  return null
}
