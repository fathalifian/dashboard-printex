'use client'

import AdminPage from '@/components/admin/admin-page'
import UserManagement from '@/components/settings/user-management'

export default function AccountsPage() {
  return <AdminPage section="akun" framed={false}><UserManagement /></AdminPage>
}
