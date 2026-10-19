'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { selectDataView, selectDataOrder } from '@/lib/production-board'

/** Loads the data a page needs: an order's full history on its detail page, metadata only on report pages. */
export default function RoomNavigation() {
  const pathname = usePathname()
  useEffect(() => {
    const id = /^\/orders\/([0-9a-f-]{36})(?:\/edit)?$/i.exec(pathname)?.[1] ?? null
    selectDataOrder(id)
    selectDataView(/^\/(reports|archives|settings)(?:\/|$)/.test(pathname))
  },[pathname])
  return null
}
