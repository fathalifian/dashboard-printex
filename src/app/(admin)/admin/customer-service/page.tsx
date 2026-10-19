'use client'

import AdminPage from '@/components/admin/admin-page'
import CustomerServiceSettings from '@/components/settings/customer-service-settings'

export default function CustomerServicePage() {
  return <AdminPage section="customer-service" framed={false}><CustomerServiceSettings /></AdminPage>
}
