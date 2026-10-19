'use client'

import { useMemo, useState } from 'react'
import type { ProductivityPaperWidth } from '@/lib/productivity'
import type { ProcessStage } from '@/lib/process-metrics'
import { growth, previousPeriod } from '@/lib/production-efficiency'
import { laborProductivity, stationLoads, type StationId } from '@/lib/production-metrics'
import { useEfficiencyInputs } from '@/lib/production-records'
import { useDashboard } from './dashboard-context'
import { useCapacity } from './capacity'
import { useFlowStops } from './flow-strip'

const STATION_STAGE: Record<StationId, ProcessStage> = { design: 'design', sublim: 'printing', press: 'press', dtf: 'printing' }

/**
 * Every production figure of the dashboard in one place: capacity and efficiency
 * (actual ÷ capacity), labour and machine productivity with growth, and station loads.
 * All follow the period and paper-width filters.
 */
export function useProductionMetrics(paperWidth: ProductivityPaperWidth) {
  const { orders, history, start, end, connection } = useDashboard()
  const [includeDesign, setIncludeDesign] = useState(false)
  const online = connection.state !== 'error'
  const inputs = useEfficiencyInputs(start, end, online)
  const capacity = useCapacity({ orders, history, start, end, paperWidth, runs: inputs.inputs?.runs ?? null })
  const previous = previousPeriod(start, end)
  const previousInputs = useEfficiencyInputs(previous?.start ?? '', previous?.end ?? '', online && !!previous)
  const stops = useFlowStops()
  const { result, settings, days } = capacity

  return useMemo(() => {
    const processOf = new Map(result.machines.map(machine => [machine.id, machine.process]))
    const machineProcess = (id: string | null) => (id && processOf.get(id)) || null
    const labor = laborProductivity({ inputs: inputs.inputs, machineProcess })
    const previousLabor = laborProductivity({ inputs: previousInputs.inputs, machineProcess })
    // Design capacity per day = design speed (order/jam) × effective hours.
    const designPerDay = settings.design_orders_per_hour ? settings.design_orders_per_hour * settings.effective_hours : null
    // Design productivity counts finished designs (orders), not meters.
    const designOrders = stops.find(item => item.stage === 'design')?.samples ?? 0
    const design = { orders: designOrders, manHours: labor?.designManHours ?? 0, perManHour: designOrders > 0 && labor?.designManHours ? designOrders / labor.designManHours : null }
    const loads = stationLoads({
      orders, start, end, days, designPerDay, includeDesign,
      capacityPerDay: { sublim: result.processes.sublim.capacity, press: result.processes.press.capacity, dtf: result.processes.dtf.capacity },
    })
    const stop = (stage: ProcessStage) => stops.find(item => item.stage === stage)
    const bottleneckRow = loads.bottleneck ? loads.rows.find(row => row.id === loads.bottleneck!.id) ?? null : null
    // Output lost per hour while the bottleneck stands still = the hourly capacity of one of its machines.
    const station = bottleneckRow && bottleneckRow.id !== 'design' ? result.processes[bottleneckRow.id] : null
    const bottleneckSpeed = station?.capacity && station.machines ? station.capacity / result.effectiveHours / station.machines : null
    return {
      capacity, labor, previousLabor, design,
      growth: {
        perManHour: growth(labor?.perManHour ?? null, previousLabor?.perManHour ?? null),
        perMachineHour: growth(labor?.perMachineHour ?? null, previousLabor?.perMachineHour ?? null),
      },
      loads, bottleneckRow, bottleneckSpeed,
      bottleneckStage: bottleneckRow ? STATION_STAGE[bottleneckRow.id] : null,
      waits: { design: stop('design')?.waitingMs ?? null, admin: stop('design_done')?.averageMs ?? stop('design_done')?.waitingMs ?? null, printing: stop('printing')?.waitingMs ?? null, press: stop('press')?.waitingMs ?? null },
      designAvailable: designPerDay !== null, includeDesign, setIncludeDesign,
      recorded: inputs.available, recordsLoaded: inputs.loaded,
      reload: () => { inputs.reload(); previousInputs.reload() },
    }
  }, [capacity, result, settings, days, inputs, previousInputs, orders, start, end, includeDesign, stops])
}
export type ProductionMetrics = ReturnType<typeof useProductionMetrics>
