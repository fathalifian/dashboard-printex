import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MOCK_ORDERS, MOCK_STEPS } from '@/lib/mock-data'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // 1. Check if orders exist
  const { data: existingOrders, error: checkError } = await supabase.from('orders').select('id').limit(1)
  if (checkError) {
    return NextResponse.json({ error: checkError }, { status: 500 })
  }
  
  if (existingOrders && existingOrders.length > 0) {
    return NextResponse.json({ message: 'Database already has data. Skipping seed.' })
  }

  // 2. Fetch steps mapping
  const { data: steps } = await supabase.from('production_steps').select('id, code')
  if (!steps) return NextResponse.json({ error: 'No steps found' }, { status: 500 })
  
  const stepMap = new Map(steps.map(s => [s.code, s.id]))

  // 3. Insert customers and orders
  let count = 0
  for (const mock of MOCK_ORDERS) {
    // Insert customer
    const { data: customer, error: custErr } = await supabase.from('customers').insert({
      name: mock.customer.name,
      phone: mock.customer.phone
    }).select('id').single()
    
    if (custErr) continue

    // Insert order
    const stepId = stepMap.get(mock.current_step.code)
    
    const { error: orderErr } = await supabase.from('orders').insert({
      spk_code: mock.spk_code,
      customer_id: customer.id,
      production_type: mock.production_type,
      meter: mock.meter,
      customer_type: mock.customer_type,
      order_state: mock.order_state,
      current_step_id: stepId,
      order_date: mock.order_date,
      due_at: mock.due_at,
      notes: mock.notes
    })

    if (!orderErr) count++
  }

  return NextResponse.json({ message: `Successfully seeded ${count} orders` })
}
