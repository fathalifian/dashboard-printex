import { jakartaDate, PROCESS_STAGES, type ProcessEvent, type ProcessStage } from './process-metrics'

type FlowOrder = { id: string; board_stage: ProcessStage; archive: { finalizedAt?: string } | null }

export function productionFlow(orders: FlowOrder[], history: ProcessEvent[], now: number, range?: { start: string; end: string }) {
  const rows = PROCESS_STAGES.map(stage => ({ stage, count: 0, samples: 0, total: 0, historicalSamples: 0, historicalTotal: 0, waiting: [] as number[], average: null as number | null, piling: false, bottleneck: false }))
  const byStage = Object.fromEntries(rows.map(row => [row.stage, row])) as Record<ProcessStage, typeof rows[number]>
  function record(stage: ProcessStage, duration: number, endedAt: number) {
    const row = byStage[stage]
    row.historicalSamples++
    row.historicalTotal += duration
    const day = jakartaDate(new Date(endedAt))
    if (!range || (day >= range.start && day <= range.end)) {
      row.total += duration
      row.samples++
    }
  }
  const open = new Map<string, { stage: ProcessStage; at: number }>()
  const events = [...history].filter(event => Number.isFinite(Date.parse(event.occurredAt)) && Date.parse(event.occurredAt) <= now)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || Number(a.kind === 'entered') - Number(b.kind === 'entered'))
  for (const event of events) {
    const current = open.get(event.orderId), at = Date.parse(event.occurredAt)
    if (event.kind === 'entered' && current?.stage === event.stage) continue
    if (current && (event.kind === 'entered' || current.stage === event.stage)) {
      const completed = event.kind === 'completed' || (event.kind === 'entered' && PROCESS_STAGES.indexOf(event.stage) > PROCESS_STAGES.indexOf(current.stage))
      if (completed) record(current.stage, Math.max(0, at - current.at), at)
      open.delete(event.orderId)
    }
    if (event.kind === 'entered') open.set(event.orderId, { stage: event.stage, at })
  }
  for (const order of orders) {
    const current = open.get(order.id), finalized = order.archive?.finalizedAt
    if (finalized) {
      const end = Date.parse(finalized)
      if (current?.stage === 'archive' && end >= current.at && end <= now) {
        record('archive', end - current.at, end)
      }
      continue
    }
    const row = byStage[order.board_stage]
    row.count++
    if (current?.stage === order.board_stage) row.waiting.push(Math.max(0, now - current.at))
  }
  const active = rows.slice(0, 5)
  const averageLoad = active.reduce((sum, row) => sum + row.count, 0) / active.length
  for (const row of rows) {
    row.average = row.samples ? row.total / row.samples : null
    const isActive = active.includes(row)
    row.piling = isActive && row.count >= 2 && row.count > averageLoad
    row.bottleneck = isActive && row.historicalSamples >= 3 && row.waiting.some(duration => duration > row.historicalTotal / row.historicalSamples)
  }
  return rows
}
