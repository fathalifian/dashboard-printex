'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getCustomerService } from '@/app/(dashboard)/settings/customer-service-actions'
import { useOnlineConnection } from '@/lib/production-board'

type Contact = { number: string; error: string; loading: boolean }
const CustomerServiceContext = createContext<Contact & { update: (number: string) => void }>({ number: '', error: '', loading: true, update: () => {} })

export default function CustomerServiceProvider({ children }: { children: ReactNode }) {
  const { profile } = useOnlineConnection()
  const [contact, setContact] = useState<Contact>({ number: '', error: '', loading: true })
  const request = useRef(0)
  const update = useCallback((number: string) => {
    request.current++
    setContact({ number, error: '', loading: false })
  }, [])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    const refresh = () => {
      const current = ++request.current
      getCustomerService().then(result => {
        if (!cancelled && current === request.current) setContact({ ...result, loading: false })
      }).catch(() => {
        if (!cancelled && current === request.current) setContact({ number: '', error: 'Nomor Customer Service belum dapat dimuat.', loading: false })
      })
    }
    refresh()
    const onFocus = () => { refresh() }
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60000)
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [profile?.id, profile?.role])

  return <CustomerServiceContext.Provider value={{ ...contact, update }}>{children}</CustomerServiceContext.Provider>
}

export function useCustomerService() { return useContext(CustomerServiceContext) }
