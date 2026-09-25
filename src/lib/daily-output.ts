import { jakartaDate, uniqueProcessEvents, type ProcessEvent } from './process-metrics'

type OutputOrder = { id: string; production_type: string; meter: number }

export function dailyOutput(orders: OutputOrder[], history: ProcessEvent[], start: string, end = start) {
  const totals = { dtf: { meter: 0, count: 0 }, sublim: { meter: 0, count: 0 } }
  const byId = new Map(orders.map(order => [order.id, order]))
  // Match the reporting convention: a repeated completion never counts twice,
  // even when an order is moved back and completed again on another day.
  for (const event of uniqueProcessEvents(history)) {
    if (event.stage !== 'printing' || event.kind !== 'completed' || !Number.isFinite(Date.parse(event.occurredAt))) continue
    const date = jakartaDate(event.occurredAt)
    if (date < start || date > end) continue
    const order = byId.get(event.orderId)
    if (!order) continue
    const total = totals[order.production_type.trim().toUpperCase() === 'DTF' ? 'dtf' : 'sublim']
    total.count += 1
    total.meter += Number.isFinite(order.meter) && order.meter > 0 ? order.meter : 0
  }
  return totals
}
