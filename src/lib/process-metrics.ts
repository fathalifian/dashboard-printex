export const PROCESS_STAGES = ['incoming', 'design', 'design_done', 'printing', 'press', 'done', 'archive'] as const
export type ProcessStage = typeof PROCESS_STAGES[number]
export type ProcessEvent = {
  branchId?: string
  id: string
  orderId: string
  spkCode: string
  customerName: string
  stage: ProcessStage
  kind: 'entered' | 'completed' | 'returned'
  occurredAt: string
  actorName: string | null
}

export function jakartaDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function transitionEvents(order: { id: string; spk_code: string; customer: { name: string } }, from: ProcessStage | null, to: ProcessStage, at: string): ProcessEvent[] {
  if (from === to) return []
  const base = { orderId: order.id, spkCode: order.spk_code, customerName: order.customer.name, occurredAt: at, actorName: null }
  const events: ProcessEvent[] = []
  if (from) events.push({ ...base, id: crypto.randomUUID(), stage: from, kind: PROCESS_STAGES.indexOf(to) > PROCESS_STAGES.indexOf(from) ? 'completed' : 'returned' })
  events.push({ ...base, id: crypto.randomUUID(), stage: to, kind: 'entered' })
  return events
}

// A milestone belongs to the original order ID, never its editable SPK/name.
// Deduplicate the complete history BEFORE date/employee filters so repeated moves
// on another day cannot create new intake/completion or inflate weekly totals.
export function uniqueProcessEvents(events: ProcessEvent[]): ProcessEvent[] {
  const first = new Map<string, ProcessEvent>()
  for (const event of events) {
    const key = JSON.stringify([event.orderId, event.stage, event.kind])
    const previous = first.get(key)
    if (!previous || Date.parse(event.occurredAt) < Date.parse(previous.occurredAt)) first.set(key, event)
  }
  return [...first.values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
}

export function summarizeEvents(events: ProcessEvent[], stage: ProcessStage, start: string, end: string) {
  const selected = uniqueProcessEvents(events).filter(event => event.stage === stage && jakartaDate(event.occurredAt) >= start && jakartaDate(event.occurredAt) <= end)
  return { events: selected, entered: selected.filter(e => e.kind === 'entered').length, completed: selected.filter(e => e.kind === 'completed').length, returned: selected.filter(e => e.kind === 'returned').length }
}

export function processReportEvents(history: ProcessEvent[], orders: Array<{
  id: string; spk_code: string; customer: { name: string }; board_stage: ProcessStage;
  archive: { finalizedAt?: string } | null
}>): ProcessEvent[] {
  const completedArchives: ProcessEvent[] = orders.flatMap(order => {
    const at = order.archive?.finalizedAt
    if (order.board_stage !== 'archive' || !at || !Number.isFinite(Date.parse(at))) return []
    return [{ id: `archive-completed-${order.id}`, orderId: order.id, spkCode: order.spk_code,
      customerName: order.customer.name, stage: 'archive', kind: 'completed', occurredAt: at, actorName: null }]
  })
  return uniqueProcessEvents([...history.filter(event => event.kind !== 'returned' && event.stage !== 'archive'), ...completedArchives])
}
