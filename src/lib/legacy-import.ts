import { MOCK_ORDERS } from '@/lib/mock-data'
import { PROCESS_STAGES, type ProcessEvent, type ProcessStage } from '@/lib/process-metrics'

// Read-only import: never reset or delete the old browser data.
export function readLegacyData(storage: Pick<Storage, 'getItem'>) {
  const read = (key: string, fallback: unknown): unknown => JSON.parse(storage.getItem(key) ?? JSON.stringify(fallback))
  const stages = read('printex-production-board-v2', {}) as Record<string, ProcessStage>
  const edits = read('printex-order-edits-v1', {}) as Record<string, { spkCode: string; customerName: string; phone: string; productionType: string; meter: number; customerType: string; orderDate: string; dueDate: string; notes: string }>
  const deleted = new Set(read('printex-deleted-orders-v1', []) as string[])
  const created = read('printex-created-orders-v1', []) as typeof MOCK_ORDERS
  const archives = read('printex-archived-orders-v1', {}) as Record<string, { archivedAt: string; deliveryMethod: string; finalizedAt?: string }>
  const history = read('printex-process-history-v1', []) as ProcessEvent[]
  const hasLegacy = ['printex-production-board-v2','printex-created-orders-v1','printex-process-history-v1'].some(key => storage.getItem(key) !== null)
  if (!hasLegacy) return { orders: [], history: [] }
  if (!Array.isArray(created) || !Array.isArray(history)) throw new Error('Format data lokal tidak valid. Data asli tetap disimpan.')
  const codeStage: Record<string, ProcessStage> = { ORDER_IN:'incoming',DESIGN:'design',DESIGN_DONE:'design_done',PRINTING:'printing',DONE:'done',ARCHIVE:'archive' }
  const orders = [...MOCK_ORDERS, ...created].filter(order => !deleted.has(order.id)).map(order => {
    const edit = edits[order.id]
    const stage = stages[order.id] ?? codeStage[order.current_step.code]
    if (!PROCESS_STAGES.includes(stage)) throw new Error('Tahap order lokal tidak dikenali')
    return { ...order, spk_code: edit?.spkCode ?? order.spk_code,
      customer: { name: edit?.customerName ?? order.customer.name, phone: edit?.phone ?? order.customer.phone },
      production_type: edit?.productionType ?? order.production_type, meter: edit?.meter ?? order.meter,
      customer_type: edit?.customerType ?? order.customer_type, order_date: edit?.orderDate ?? order.order_date,
      due_at: edit?.dueDate ?? order.due_at, notes: edit?.notes ?? order.notes, board_stage: stage, archive: archives[order.id] ?? null }
  })
  return { orders, history }
}
