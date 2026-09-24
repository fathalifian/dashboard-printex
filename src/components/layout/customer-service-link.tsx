'use client'

import Link from 'next/link'
import { Headset } from 'lucide-react'
import { useCustomerService } from '@/components/customer-service-provider'
import { useOnlineConnection } from '@/lib/production-board'
import { canManageOrders } from '@/lib/access-control'
import { whatsappUrl } from '@/lib/customer-service'

export default function CustomerServiceLink() {
  const { number, loading, error } = useCustomerService()
  const manage = canManageOrders(useOnlineConnection().profile?.role)
  const url = !loading && !error ? whatsappUrl(number) : null
  const content = <><Headset aria-hidden="true" size={21} className="shrink-0" /><span className="text-sm font-semibold">Hubungi Kami</span></>
  return <div className="workspace-support">
    {url ? <a className="customer-service-link" href={url} target="_blank" rel="noopener noreferrer" aria-label="Hubungi Kami melalui WhatsApp (tab baru)">{content}</a>
      : !loading && manage ? <Link className="customer-service-link" href="/settings#customer-service">{content}</Link>
      : <div className="customer-service-link" aria-disabled="true" title={loading ? 'Memuat kontak...' : 'Kontak belum tersedia'}>{content}</div>}
  </div>
}
