import { jakartaDate, type ProcessEvent } from './process-metrics'
import { orderTiming, type TimedOrder } from './process-timing'

type ProductivityProcess = 'sublim' | 'dtf' | 'press'
export type ProductivityPaperWidth = 'all' | '1.2' | '1.6' | '1.8'
export type ProductivityOrder = TimedOrder & {
  spk_code: string
  production_type: string
  paper_width?: string | null
  meter: number
}
type ProductivityRow = {
  orderId: string
  spkCode: string
  productionType: string
  paperWidth: string | null
  process: ProductivityProcess
  meter: number
  durationMilliseconds: number
}
type ProductivitySummary = {
  orderCount: number
  totalMeter: number
  totalMilliseconds: number
  hours: number
  productivity: number | null
  cycleTimeSecondsPerMeter: number | null
  averageDurationMilliseconds: number | null
}

const nonnegative = (value: number) => Number.isFinite(value) && value > 0 ? value : 0

export function summarizeProductivity(rows: readonly ProductivityRow[]): ProductivitySummary {
  const orderCount = rows.length
  const totalMeter = rows.reduce((sum, row) => sum + nonnegative(row.meter), 0)
  const totalMilliseconds = rows.reduce((sum, row) => sum + nonnegative(row.durationMilliseconds), 0)
  const hours = totalMilliseconds / 3_600_000
  return {
    orderCount, totalMeter, totalMilliseconds, hours,
    productivity: totalMeter > 0 && totalMilliseconds > 0 ? totalMeter / hours : null,
    cycleTimeSecondsPerMeter: totalMeter > 0 ? (totalMilliseconds / 1000) / totalMeter : null,
    averageDurationMilliseconds: orderCount > 0 ? totalMilliseconds / orderCount : null,
  }
}

export function normalizeProductivityPaperWidth(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const width = Number(value.trim().replace(',', '.'))
  return Number.isFinite(width) && width > 0 ? String(width) : null
}

export function productivityRows(
  orders: readonly ProductivityOrder[],
  history: readonly ProcessEvent[],
  start: string,
  end: string,
  paperWidth: ProductivityPaperWidth = 'all',
): Record<ProductivityProcess, ProductivityRow[]> {
  const result: Record<ProductivityProcess, ProductivityRow[]> = { sublim: [], dtf: [], press: [] }
  if (!start || !end || start > end) return result
  const indexed = new Map<string, ProcessEvent[]>()
  for (const event of history) {
    const events = indexed.get(event.orderId)
    if (events) events.push(event)
    else indexed.set(event.orderId, [event])
  }
  for (const order of orders) {
    const isDTF = order.production_type.trim().toUpperCase() === 'DTF'
    const width = normalizeProductivityPaperWidth(order.paper_width)
    // Paper width narrows non-DTF orders; DTF remains independently reportable.
    if (!isDTF && paperWidth !== 'all' && width !== paperWidth) continue
    const events = indexed.get(order.id) ?? []
    // Closed intervals do not depend on a live clock. Use the latest recorded
    // timestamp (not the range end), so later revisits retain their real lastExit.
    const snapshotTime = events.reduce((latest, event) => {
      const at = Date.parse(event.occurredAt)
      return Number.isFinite(at) ? Math.max(latest, at) : latest
    }, 0)
    const timing = orderTiming(order, events, snapshotTime)
    for (const stage of ['printing', 'press'] as const) {
      const duration = timing.stages[stage]
      if (!duration.visited || duration.running || !duration.lastExit) continue
      const day = jakartaDate(duration.lastExit)
      if (day < start || day > end) continue
      const process = stage === 'press' ? 'press' : isDTF ? 'dtf' : 'sublim'
      result[process].push({
        orderId: order.id, spkCode: order.spk_code, productionType: order.production_type,
        paperWidth: width, process, meter: nonnegative(order.meter),
        durationMilliseconds: nonnegative(duration.milliseconds),
      })
    }
  }
  return result
}
