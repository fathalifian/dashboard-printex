import { jakartaDate, uniqueProcessEvents, type ProcessEvent } from './process-metrics'
export const PAPER_WIDTHS = ['0.6', '1.2', '1.6', '1.8'] as const
export type PaperWidth = typeof PAPER_WIDTHS[number]
export function paperLabel(width: string) { return width === '0.6' ? 'DTF 0,6 m' : width.replace('.', ',') + ' m' }
type PaperOrder = { id: string; production_type: string; meter: number; paper_width?: string | null }
type Totals = Record<PaperWidth | 'unknown', {meter:number; count:number}>
const empty = () => Object.fromEntries([...PAPER_WIDTHS, 'unknown'].map(key => [key, {meter:0,count:0}])) as Totals
export function paperOutput(orders: PaperOrder[], history: ProcessEvent[], start: string, end = start) {
  const totals = empty(), byDay = new Map<string, Totals>()
  const byId = new Map(orders.map(order => [order.id, order]))
  for (const event of uniqueProcessEvents(history)) {
    if (event.stage !== 'printing' || event.kind !== 'completed' || !Number.isFinite(Date.parse(event.occurredAt))) continue
    const day = jakartaDate(event.occurredAt)
    if (day < start || day > end) continue
    const order = byId.get(event.orderId)
    if (!order) continue
    const key = order.production_type.trim().toUpperCase() === 'DTF' ? '0.6' : order.paper_width !== '0.6' && PAPER_WIDTHS.includes(order.paper_width as PaperWidth) ? order.paper_width as PaperWidth : 'unknown'
    const meter = Number.isFinite(order.meter) && order.meter > 0 ? order.meter : 0
    totals[key].meter += meter; totals[key].count++
    if (!byDay.has(day)) byDay.set(day, empty())
    byDay.get(day)![key].meter += meter; byDay.get(day)![key].count++
  }
  const trend: {day:string; values:Totals}[] = []
  const first = new Date(start+'T12:00:00Z'), last = new Date(end+'T12:00:00Z')
  for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate()+1)) {
    const date = day.toISOString().slice(0,10)
    trend.push({day:date,values:byDay.get(date) ?? empty()})
  }
  return {totals,trend}
}
