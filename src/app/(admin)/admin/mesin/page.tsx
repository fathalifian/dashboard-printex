'use client'

import AdminPage from '@/components/admin/admin-page'
import MachineSettings from '@/components/settings/machine-settings'

export default function MachinesPage() {
  return <AdminPage section="mesin"><MachineSettings framed={false} /></AdminPage>
}
