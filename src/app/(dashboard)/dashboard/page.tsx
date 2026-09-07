import { getOrders } from '@/app/actions/order'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const orders = await getOrders()
  
  return (
    <DashboardClient initialOrders={orders} />
  )
}
