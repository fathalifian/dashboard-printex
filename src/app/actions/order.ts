'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// We define our OrderType to match the frontend expectations
export type SupabaseOrder = {
  id: string
  spk_code: string
  production_type: string
  meter: number
  customer_type: string
  order_state: string
  order_date: string
  due_at: string
  notes: string
  created_at: string
  customer: { name: string; phone: string }
  current_step: { code: string; name: string }
}

export async function getOrders(): Promise<SupabaseOrder[]> {
  const supabase = await createClient()
  
  // Ambil data production_steps karena current_step_id tidak memiliki Foreign Key constraint eksplisit di skema
  const { data: stepsData } = await supabase.from('production_steps').select('id, code, name')
  const stepsMap = new Map((stepsData || []).map(s => [s.id, s]))

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, spk_code, production_type, meter, customer_type, order_state, order_date, due_at, notes, created_at, current_step_id,
      customer:customers(name, phone)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching orders:', error)
    return []
  }

  // Format to match frontend
  return data.map((order: any) => {
    const step = stepsMap.get(order.current_step_id)
    return {
      id: order.id,
      spk_code: order.spk_code,
      production_type: order.production_type,
      meter: Number(order.meter),
      customer_type: order.customer_type,
      order_state: order.order_state,
      order_date: order.order_date,
      due_at: order.due_at,
      notes: order.notes,
      created_at: order.created_at,
      customer: order.customer ? { name: order.customer.name, phone: order.customer.phone ?? '' } : { name: 'Unknown', phone: '' },
      current_step: step ? { code: step.code, name: step.name } : { code: 'ORDER_IN', name: 'Order Masuk' },
    }
  })
}

export async function deleteOrderAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('orders').delete().eq('id', id)
  
  if (error) {
    console.error('Error deleting order:', error)
    return { success: false, error: error.message }
  }
  
  revalidatePath('/orders')
  revalidatePath('/dashboard')
  return { success: true }
}
