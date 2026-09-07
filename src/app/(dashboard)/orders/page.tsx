import { getOrders } from '@/app/actions/order'
import OrderListClient from './OrderListClient'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const orders = await getOrders()
  
  return (
    <OrderListClient initialOrders={orders} />
  )
}
