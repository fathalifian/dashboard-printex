'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAllOrders, useOnlineConnection, useProcessHistory } from '@/lib/production-board'
import { jakartaDate, type ProcessStage } from '@/lib/process-metrics'
import { outputForCompletions, printCompletions } from '@/lib/daily-output'
import { useDailySummary, storedOutput, storedTrend } from '@/lib/report-summaries'
import { longestPendingOrders, shiftDate } from '@/lib/pending-orders'
import { todayRange, type DateRange } from '@/components/ui/date-range-filter'
import type { ProductivityPaperWidth } from '@/lib/productivity'

function useDashboardState() {
  const orders = useAllOrders(), history = useProcessHistory(), connection = useOnlineConnection()
  const [range, setRange] = useState<DateRange>(todayRange)
  const [stage, setStage] = useState<ProcessStage | 'all'>('all')
  // Paper width narrows Sublim/Press capacity, productivity, efficiency and bottleneck figures.
  const [paperWidth, setPaperWidth] = useState<ProductivityPaperWidth>('all')
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const tick = () => setNow(new Date())
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') tick() }, 30000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [])
  const today = now ? jakartaDate(now) : ''
  const start = range.period === 'today' ? today || range.start : range.start
  const end = range.period === 'today' ? today || range.end : range.end
  const saved = useDailySummary(start, end)
  const summary = useMemo(() => {
    const completions = saved.enabled ? [] : printCompletions(history)
    const output = saved.enabled ? storedOutput(saved.rows) : outputForCompletions(orders, completions, start, end)
    const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1)
    const trend = saved.enabled ? storedTrend(saved.rows, start, end) : Array.from({ length: days }, (_, index) => {
      const day = shiftDate(start, index)
      return { day, ...outputForCompletions(orders, completions, day, day) }
    })
    const pendingOrders = orders.filter(order => order.order_date >= start && order.order_date <= end && order.order_state !== 'completed' && order.order_state !== 'cancelled' && !order.archive?.finalizedAt)
    const overdue = pendingOrders.filter(order => order.due_at && order.due_at < today).sort((a, b) => a.due_at.localeCompare(b.due_at))
    const dueInPeriod = pendingOrders.filter(order => order.due_at >= start && order.due_at <= end)
    return { output, trend, pendingOrders, overdue, dueInPeriod }
  }, [orders, history, start, end, today, saved.enabled, saved.rows])
  const longest = useMemo(() => now ? longestPendingOrders(summary.pendingOrders, history, now) : [], [summary.pendingOrders, history, now])
  const ready = connection.state === 'ready' && !!today && !(saved.enabled && (saved.loading || !!saved.error))
  const message = saved.enabled && saved.error ? 'Ringkasan belum tersedia.' : connection.state === 'error' ? 'Data belum tersedia. Periksa koneksi data.' : 'Memuat dashboard...'
  return { orders, history, connection, range, setRange, stage, setStage, paperWidth, setPaperWidth, now, today, start, end, saved, ...summary, longest, ready, message }
}

export type DashboardState = ReturnType<typeof useDashboardState>
const DashboardContext = createContext<DashboardState | null>(null)

/** Period, stage filter and headline numbers shared by every dashboard page, kept while switching pages. */
export function DashboardProvider({ children }: { children: ReactNode }) {
  const state = useDashboardState()
  return <DashboardContext.Provider value={state}>{children}</DashboardContext.Provider>
}

export function useDashboard() {
  const state = useContext(DashboardContext)
  if (!state) throw new Error('useDashboard harus dipakai di dalam DashboardProvider.')
  return state
}
