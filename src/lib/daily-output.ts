import { jakartaDate, uniqueProcessEvents, type ProcessEvent } from './process-metrics'

type OutputOrder = { id: string; production_type: string; meter: number }

export function printCompletions(history: ProcessEvent[]) {
  return uniqueProcessEvents(history)
    .filter(event => event.stage === 'printing' && event.kind === 'completed' && Number.isFinite(Date.parse(event.occurredAt)))
    .map(event => ({ orderId: event.orderId, date: jakartaDate(event.occurredAt) }))
}

export function outputForCompletions(orders: OutputOrder[], completions: ReturnType<typeof printCompletions>, start: string, end = start) {
  const totals = { dtf: { meter: 0, count: 0 }, sublim: { meter: 0, count: 0 } }
  const byId = new Map(orders.map(order => [order.id, order]))
  // Match the reporting convention: a repeated completion never counts twice,
  // even when an order is moved back and completed again on another day.
  for (const event of completions) {
    const date = event.date
    if (date < start || date > end) continue
    const order = byId.get(event.orderId)
    if (!order) continue
    const total = totals[order.production_type.trim().toUpperCase() === 'DTF' ? 'dtf' : 'sublim']
    total.count += 1
    total.meter += Number.isFinite(order.meter) && order.meter > 0 ? order.meter : 0
  }
  return totals
}

export function dailyOutput(orders: OutputOrder[], history: ProcessEvent[], start: string, end = start) {
  return outputForCompletions(orders, printCompletions(history), start, end)
}
