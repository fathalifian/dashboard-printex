import type { ProcessEvent } from './process-metrics'
import type { BoardOrder } from './production-board'

/** The ISO day `offset` days after `day` (negative goes back). */
export function shiftDate(day: string, offset: number) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** The five pending orders waiting longest in their current stage (latest entry after a return). */
export function longestPendingOrders(pending: BoardOrder[], history: ProcessEvent[], now: Date) {
  const byId = new Map(pending.map(order => [order.id, order]))
  const latestEntry = new Map<string, number>()
  for (const event of history) {
    const order = byId.get(event.orderId)
    const time = Date.parse(event.occurredAt)
    if (order && event.kind === 'entered' && event.stage === order.board_stage && Number.isFinite(time) && time <= now.getTime()) {
      latestEntry.set(order.id, Math.max(latestEntry.get(order.id) ?? 0, time))
    }
  }
  return pending.flatMap(order => {
    const since = latestEntry.get(order.id) ?? (order.board_stage === 'incoming' ? Date.parse(order.created_at) : NaN)
    return Number.isFinite(since) && since <= now.getTime() ? [{order, milliseconds: now.getTime() - since}] : []
  }).sort((a,b) => b.milliseconds-a.milliseconds).slice(0,5)
}
