'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, AlertTriangle, CheckCircle2, Loader2, Circle, Clock } from 'lucide-react'
import { MOCK_ORDERS, MOCK_ACTIVITIES, MOCK_STEPS } from '@/lib/mock-data'
import { StatusBadge } from '@/components/ui/badges'
import { formatDueDate, isOverdue, formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'

const STEP_COLORS: Record<string, string> = {
  ORDER_IN: 'amber',
  DESIGN: 'red',
  DESIGN_DONE: 'blue',
  PRINTING: 'amber',
  DONE: 'emerald',
  ARCHIVE: 'slate',
}

function getStepState(order: typeof MOCK_ORDERS[0], stepCode: string) {
  const steps = MOCK_STEPS
  const currentIdx = steps.findIndex(s => s.code === order.current_step.code)
  const stepIdx = steps.findIndex(s => s.code === stepCode)
  if (order.order_state === 'completed') return 'completed'
  if (stepIdx < currentIdx) return 'completed'
  if (stepIdx === currentIdx) return 'active'
  return 'pending'
}

export default function TrackingPage() {
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<typeof MOCK_ORDERS[0] | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const activeOrders = MOCK_ORDERS.filter(o => o.order_state === 'active')

  const searchResults = search.trim()
    ? MOCK_ORDERS.filter(o =>
        o.spk_code.toLowerCase().includes(search.toLowerCase()) ||
        o.customer.name.toLowerCase().includes(search.toLowerCase()) ||
        o.customer.phone.includes(search.replace(/\D/g, ''))
      )
    : []

  const displayOrder = selectedOrder ?? (activeOrders[0] || null)
  const activities = displayOrder ? MOCK_ACTIVITIES.filter(a => a.order_id === displayOrder.id) : []

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setShowSuggestions(true) }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="Cari SPK / Nama Customer / No. WhatsApp..."
          className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm"
        />
        {/* Search Suggestions */}
        {showSuggestions && search && searchResults.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
            {searchResults.slice(0, 5).map(order => {
              const overdue = isOverdue(order.due_at, order.order_state)
              return (
                <button
                  key={order.id}
                  onMouseDown={() => { setSelectedOrder(order); setSearch('') }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                      <code className="font-mono text-sm font-bold text-slate-900">{order.spk_code}</code>
                    </div>
                    <p className="text-xs text-slate-400">{order.customer.name} · {order.customer.phone}</p>
                  </div>
                  <StatusBadge
                    stepCode={order.current_step.code}
                    stepName={order.current_step.name}
                    colorToken={STEP_COLORS[order.current_step.code]}
                    size="sm"
                  />
                </button>
              )
            })}
          </div>
        )}
        {showSuggestions && search && searchResults.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <p className="text-sm text-slate-400">Order tidak ditemukan.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Order Detail + Timeline */}
        <div className="lg:col-span-2 space-y-5">
          {displayOrder ? (
            <>
              {/* Order Info Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono text-base font-bold text-slate-900">{displayOrder.spk_code}</code>
                      {isOverdue(displayOrder.due_at, displayOrder.order_state) && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Terlambat
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-semibold text-slate-900">{displayOrder.customer.name}</p>
                    <p className="text-sm text-slate-400">{displayOrder.customer.phone}</p>
                  </div>
                  <StatusBadge
                    stepCode={displayOrder.current_step.code}
                    stepName={displayOrder.current_step.name}
                    colorToken={STEP_COLORS[displayOrder.current_step.code]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs text-slate-400">Jenis</p>
                    <p className="text-sm font-medium text-slate-900">{displayOrder.production_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Meter</p>
                    <p className="text-sm font-medium text-slate-900">{displayOrder.meter} m</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Tgl Order</p>
                    <p className="text-sm font-medium text-slate-900">{displayOrder.order_date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Due Date</p>
                    <p className={cn('text-sm font-medium', isOverdue(displayOrder.due_at, displayOrder.order_state) ? 'text-red-600' : 'text-slate-900')}>
                      {formatDueDate(displayOrder.due_at, displayOrder.order_state)}
                    </p>
                  </div>
                </div>
                {displayOrder.notes && (
                  <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-400 mb-0.5">Catatan</p>
                    <p className="text-sm text-slate-700">{displayOrder.notes}</p>
                  </div>
                )}
                <div className="mt-4 flex justify-end">
                  <Link href={`/orders/${displayOrder.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                    Buka Detail Order →
                  </Link>
                </div>
              </div>

              {/* Production Timeline (horizontal) */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-6">Timeline Produksi</h3>
                <div className="relative flex items-start justify-between px-4">
                  <div className="absolute left-8 right-8 top-4 h-0.5 bg-slate-100" />
                  {MOCK_STEPS.filter(s => s.code !== 'ARCHIVE').map((step) => {
                    const state = getStepState(displayOrder, step.code)
                    return (
                      <div key={step.code} className="relative flex flex-col items-center z-10 flex-1">
                        <div className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white',
                          state === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white' :
                          state === 'active' ? 'border-blue-500 text-blue-600' :
                          'border-slate-200 text-slate-300'
                        )}>
                          {state === 'completed' ? <CheckCircle2 className="h-4 w-4" /> :
                           state === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                           <Circle className="h-4 w-4" />}
                        </div>
                        <p className={cn('mt-2 text-xs font-medium text-center max-w-[64px]',
                          state === 'completed' ? 'text-emerald-600' :
                          state === 'active' ? 'text-blue-600' :
                          'text-slate-400'
                        )}>{step.name}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Activity Log */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-3.5">
                  <h3 className="text-sm font-semibold text-slate-900">Log Aktivitas</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {activities.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-slate-400 text-center">Belum ada aktivitas untuk order ini.</p>
                  ) : activities.map(a => (
                    <div key={a.id} className="flex gap-3 px-5 py-3.5">
                      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50">
                        <Clock className="h-3.5 w-3.5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{a.message}</p>
                        <p className="text-xs text-slate-400">{a.actor} · {formatRelative(a.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm text-slate-400">Cari atau pilih order untuk melihat detail tracking</p>
            </div>
          )}
        </div>

        {/* Active Orders List (sidebar) */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Order Aktif ({activeOrders.length})</h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {activeOrders.map(order => {
              const overdue = isOverdue(order.due_at, order.order_state)
              const isSelected = displayOrder?.id === order.id
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors',
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : '',
                    overdue && !isSelected ? 'bg-red-50/30' : ''
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {overdue && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                      <code className="font-mono text-sm font-bold text-slate-900">{order.spk_code}</code>
                    </div>
                    <StatusBadge
                      stepCode={order.current_step.code}
                      stepName={order.current_step.name}
                      colorToken={STEP_COLORS[order.current_step.code]}
                      size="sm"
                    />
                  </div>
                  <p className="text-xs font-medium text-slate-700">{order.customer.name}</p>
                  <p className={cn('text-xs', overdue ? 'text-red-500 font-medium' : 'text-slate-400')}>
                    Due: {formatDueDate(order.due_at, order.order_state)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
