'use client'

import AdminPage from '@/components/admin/admin-page'
import OperatorShiftSettings from '@/components/settings/operator-shift-settings'

export default function OperatorHoursPage() {
  return <AdminPage section="jam-operator"><OperatorShiftSettings /></AdminPage>
}
