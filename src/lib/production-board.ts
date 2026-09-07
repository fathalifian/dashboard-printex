'use client'

import { useSyncExternalStore } from 'react'
import { MOCK_ORDERS } from '@/lib/mock-data'
import { jakartaDate, PROCESS_STAGES, transitionEvents, type ProcessEvent } from '@/lib/process-metrics'

export type BoardStageId = 'incoming' | 'design' | 'design_done' | 'printing' | 'done' | 'archive'

export const BOARD_STAGE_META: Record<BoardStageId, { code: string; name: string; color: string; orderState: string }> = {
  incoming: { code: 'ORDER_IN', name: 'Order Masuk', color: 'slate', orderState: 'active' },
  design: { code: 'DESIGN', name: 'Proses Design', color: 'red', orderState: 'active' },
  design_done: { code: 'DESIGN_DONE', name: 'Design Done', color: 'blue', orderState: 'active' },
  printing: { code: 'PRINTING', name: 'Proses Cetak', color: 'amber', orderState: 'active' },
  done: { code: 'DONE', name: 'Done', color: 'emerald', orderState: 'completed' },
  archive: { code: 'ARCHIVE', name: 'Arsip', color: 'slate', orderState: 'completed' },
}

const STORAGE_KEY = 'printex-production-board-v2'
const EDITS_STORAGE_KEY = 'printex-order-edits-v1'
const DELETED_STORAGE_KEY = 'printex-deleted-orders-v1'
const CREATED_STORAGE_KEY = 'printex-created-orders-v1'
const HISTORY_STORAGE_KEY = 'printex-process-history-v1'
const ARCHIVE_STORAGE_KEY = 'printex-archived-orders-v1'
// One explicit reset requested by the user. Never rotate this key by date.
const RESET_KEY = 'printex-fresh-ten-orders-20260907-v1'
const STATE_KEYS = [STORAGE_KEY, EDITS_STORAGE_KEY, DELETED_STORAGE_KEY, CREATED_STORAGE_KEY, HISTORY_STORAGE_KEY, ARCHIVE_STORAGE_KEY]
export type DeliveryMethod = 'pickup' | 'delivery'
type ArchiveRecord = { archivedAt: string; deliveryMethod: DeliveryMethod; finalizedAt?: string }
let archives: Record<string, ArchiveRecord> = {}
const EMPTY_HISTORY: ProcessEvent[] = []
let history: ProcessEvent[] = EMPTY_HISTORY
const listeners = new Set<() => void>()
let stages: Record<string, BoardStageId> = Object.fromEntries(MOCK_ORDERS.map((order) => [order.id, defaultStage(order.current_step.code)]))
export type OrderEditInput = { spkCode: string; customerName: string; phone: string; productionType: string; meter: number; customerType: string; orderDate: string; dueDate: string; notes: string }
export type NewOrderInput = Omit<OrderEditInput, 'spkCode' | 'phone'>
type LocalOrder = {
  id: string
  spk_code: string
  customer: { name: string; phone: string }
  production_type: string
  meter: number
  customer_type: string
  order_state: string
  current_step: { code: string; name: string }
  order_date: string
  due_at: string
  notes: string
  created_at: string
}
let edits: Record<string, OrderEditInput> = {}
let deletedOrderIds = new Set<string>()
let createdOrders: LocalOrder[] = []
let loaded = false
let snapshot = buildSnapshot()

function defaultStage(code: string): BoardStageId {
  return ({ ORDER_IN: 'incoming', DESIGN: 'design', DESIGN_DONE: 'design_done', PRINTING: 'printing', DONE: 'done', ARCHIVE: 'archive' } as Record<string, BoardStageId>)[code] ?? 'incoming'
}

function buildSnapshot() {
  const sourceOrders: LocalOrder[] = [...MOCK_ORDERS, ...createdOrders]
  return sourceOrders.filter((order) => !deletedOrderIds.has(order.id)).map((order) => {
    const stage = stages[order.id] ?? defaultStage(order.current_step.code)
    const meta = BOARD_STAGE_META[stage]
    const edit = edits[order.id]
    return {
      ...order,
      spk_code: edit?.spkCode ?? order.spk_code,
      customer: { name: edit?.customerName ?? order.customer.name, phone: edit?.phone ?? order.customer.phone },
      production_type: edit?.productionType ?? order.production_type,
      meter: edit?.meter ?? order.meter,
      customer_type: edit?.customerType ?? order.customer_type,
      order_date: edit?.orderDate ?? order.order_date,
      due_at: edit?.dueDate ?? order.due_at,
      notes: edit?.notes ?? order.notes,
      board_stage: stage,
      current_step: { code: meta.code, name: meta.name },
      order_state: meta.orderState,
      color_token: meta.color,
      archive: archives[order.id] ?? null,
    }
  })
}

function loadBrowserState() {
  if (loaded || typeof window === 'undefined') return
  initializeFreshOrders()
  loaded = true
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, BoardStageId>
    stages = { ...stages, ...Object.fromEntries(Object.entries(saved).filter(([, stage]) => stage in BOARD_STAGE_META)) }
    edits = JSON.parse(window.localStorage.getItem(EDITS_STORAGE_KEY) ?? '{}') as Record<string, OrderEditInput>
    deletedOrderIds = new Set(JSON.parse(window.localStorage.getItem(DELETED_STORAGE_KEY) ?? '[]') as string[])
    createdOrders = JSON.parse(window.localStorage.getItem(CREATED_STORAGE_KEY) ?? '[]') as LocalOrder[]
    archives = JSON.parse(window.localStorage.getItem(ARCHIVE_STORAGE_KEY) ?? '{}') as Record<string, ArchiveRecord>
    snapshot = buildSnapshot()
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(EDITS_STORAGE_KEY)
    window.localStorage.removeItem(DELETED_STORAGE_KEY)
    window.localStorage.removeItem(CREATED_STORAGE_KEY)
  }
  try {
    const savedHistory = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]')
    history = Array.isArray(savedHistory) ? savedHistory.filter((event) => event && typeof event.id === 'string' && typeof event.orderId === 'string' && typeof event.spkCode === 'string' && typeof event.customerName === 'string' && event.stage in BOARD_STAGE_META && ['entered', 'completed', 'returned'].includes(event.kind) && Number.isFinite(Date.parse(event.occurredAt))) : EMPTY_HISTORY
  } catch { history = EMPTY_HISTORY }
}

function initializeFreshOrders() {
  if (window.localStorage.getItem(RESET_KEY)) return
  const backupKey = `${RESET_KEY}-backup`
  if (!window.localStorage.getItem(backupKey)) window.localStorage.setItem(backupKey, JSON.stringify(Object.fromEntries(STATE_KEYS.map(key => [key, window.localStorage.getItem(key)]))))
  const now = new Date().toISOString()
  const today = jakartaDate(now)
  const freshOrders: LocalOrder[] = MOCK_ORDERS.slice(0, 10).map((order, index) => ({
    ...order,
    id: `local-${crypto.randomUUID()}`,
    spk_code: `SPK-${1100 + index}`,
    customer: { name: order.customer.name, phone: '' },
    order_state: 'active',
    current_step: { code: 'ORDER_IN', name: 'Order Masuk' },
    order_date: today,
    due_at: today,
    created_at: now,
    notes: '',
  }))
  const freshHistory = freshOrders.flatMap(order => transitionEvents(order, null, 'incoming', now))
  window.localStorage.setItem(CREATED_STORAGE_KEY, JSON.stringify(freshOrders))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(freshOrders.map(order => [order.id, 'incoming']))))
  window.localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(MOCK_ORDERS.map(order => order.id)))
  window.localStorage.setItem(EDITS_STORAGE_KEY, '{}')
  window.localStorage.setItem(ARCHIVE_STORAGE_KEY, '{}')
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(freshHistory))
  window.localStorage.setItem(RESET_KEY, now)
}

function recordTransition(order: { id: string; spk_code: string; customer: { name: string } }, from: BoardStageId | null, to: BoardStageId) {
  history = [...history, ...transitionEvents(order, from, to, new Date().toISOString())]
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function subscribe(listener: () => void) {
  loadBrowserState()
  listeners.add(listener)
  function onStorage(event: StorageEvent) {
    if (event.key !== null && !STATE_KEYS.includes(event.key)) return
    loaded = false
    stages = Object.fromEntries(MOCK_ORDERS.map((order) => [order.id, defaultStage(order.current_step.code)]))
    loadBrowserState()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

export function moveOrderToStage(orderId: string, stage: BoardStageId): boolean {
  loadBrowserState()
  const order = snapshot.find((item) => item.id === orderId)
  if (!order || order.board_stage === stage || order.board_stage === 'archive' || stage === 'archive') return false
  if (Math.abs(PROCESS_STAGES.indexOf(stage) - PROCESS_STAGES.indexOf(order.board_stage)) !== 1 || !PROCESS_STAGES.includes(stage)) return false
  recordTransition(order, order.board_stage, stage)
  stages = { ...stages, [orderId]: stage }
  snapshot = buildSnapshot()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stages))
  listeners.forEach((listener) => listener())
  return true
}

export function updateOrder(orderId: string, input: OrderEditInput) {
  loadBrowserState()
  if (!snapshot.some(order => order.id === orderId && order.board_stage !== 'archive')) return
  edits = { ...edits, [orderId]: input }
  snapshot = buildSnapshot()
  window.localStorage.setItem(EDITS_STORAGE_KEY, JSON.stringify(edits))
  listeners.forEach((listener) => listener())
}

export function addOrder(input: NewOrderInput) {
  loadBrowserState()
  const allCodes = [...MOCK_ORDERS, ...createdOrders, ...Object.values(edits)].map((order) => 'spk_code' in order ? order.spk_code : order.spkCode)
  const highestSpk = Math.max(1099, ...allCodes.map((code) => Number(code.match(/\d+/)?.[0] ?? 0)))
  const id = `local-${crypto.randomUUID()}`
  const order: LocalOrder = {
    id,
    spk_code: `SPK-${highestSpk + 1}`,
    customer: { name: input.customerName, phone: '' },
    production_type: input.productionType,
    meter: input.meter,
    customer_type: input.customerType,
    order_state: 'active',
    current_step: { code: 'ORDER_IN', name: 'Order Masuk' },
    order_date: input.orderDate,
    due_at: input.dueDate,
    notes: input.notes,
    created_at: new Date().toISOString(),
  }
  createdOrders = [...createdOrders, order]
  recordTransition(order, null, 'incoming')
  stages = { ...stages, [id]: 'incoming' }
  snapshot = buildSnapshot()
  window.localStorage.setItem(CREATED_STORAGE_KEY, JSON.stringify(createdOrders))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stages))
  listeners.forEach((listener) => listener())
  return order
}

export function deleteOrder(orderId: string) {
  loadBrowserState()
  if (!snapshot.some(order => order.id === orderId && order.board_stage !== 'archive')) return
  const isCreatedOrder = createdOrders.some((order) => order.id === orderId)
  createdOrders = createdOrders.filter((order) => order.id !== orderId)
  if (!isCreatedOrder) deletedOrderIds = new Set([...deletedOrderIds, orderId])
  delete edits[orderId]
  delete stages[orderId]
  snapshot = buildSnapshot()
  window.localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deletedOrderIds]))
  window.localStorage.setItem(CREATED_STORAGE_KEY, JSON.stringify(createdOrders))
  window.localStorage.setItem(EDITS_STORAGE_KEY, JSON.stringify(edits))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stages))
  listeners.forEach((listener) => listener())
}

export function archiveOrder(orderId: string, deliveryMethod: DeliveryMethod): boolean {
  loadBrowserState()
  const order = snapshot.find(item => item.id === orderId)
  if (!order || order.board_stage !== 'done' || !['pickup', 'delivery'].includes(deliveryMethod)) return false
  const archivedAt = new Date().toISOString()
  const nextArchives = { ...archives, [orderId]: { archivedAt, deliveryMethod } }
  const nextHistory = [...history, ...transitionEvents(order, 'done', 'archive', archivedAt)]
  const nextStages = { ...stages, [orderId]: 'archive' as const }
  // Persist before notifying subscribers. Keep the complete order and its ID.
  window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(nextArchives))
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStages))
  archives = nextArchives
  history = nextHistory
  stages = nextStages
  snapshot = buildSnapshot()
  listeners.forEach(listener => listener())
  return true
}

export function useAllOrders() {
  return useSyncExternalStore(subscribe, () => { loadBrowserState(); return snapshot }, () => snapshot)
}

// A single durable write finalizes the archive. Repeated clicks cannot replace
// the original reporting date, and the order retains its identity and history.
export function finishArchivedOrder(orderId: string): boolean {
  loadBrowserState()
  const order = snapshot.find(item => item.id === orderId)
  if (!order || order.board_stage !== 'archive' || !order.archive || order.archive.finalizedAt) return false
  const nextArchives = { ...archives, [orderId]: { ...order.archive, finalizedAt: new Date().toISOString() } }
  window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(nextArchives))
  archives = nextArchives
  snapshot = buildSnapshot()
  listeners.forEach(listener => listener())
  return true
}

let productionSource = snapshot
let productionSnapshot = snapshot.filter(order => !order.archive?.finalizedAt)
function getProductionOrders() {
  if (productionSource !== snapshot) {
    productionSource = snapshot
    productionSnapshot = snapshot.filter(order => !order.archive?.finalizedAt)
  }
  return productionSnapshot
}
export function useProductionOrders() {
  return useSyncExternalStore(subscribe, () => { loadBrowserState(); return getProductionOrders() }, getProductionOrders)
}

let activeSource = snapshot
let activeSnapshot = snapshot.filter(order => order.board_stage !== 'archive')
function getActiveOrders() {
  if (activeSource !== snapshot) {
    activeSource = snapshot
    activeSnapshot = snapshot.filter(order => order.board_stage !== 'archive')
  }
  return activeSnapshot
}
export function useBoardOrders() {
  return useSyncExternalStore(subscribe, () => { loadBrowserState(); return getActiveOrders() }, getActiveOrders)
}

export function useProcessHistory() {
  return useSyncExternalStore(subscribe, () => { loadBrowserState(); return history }, () => EMPTY_HISTORY)
}
