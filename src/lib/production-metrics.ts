// Combines the records of migration 0014 (print runs, man-hours) and the orders into
// productivity and bottleneck figures. Pure functions; every unknown value is null, never 0.
import { findBottleneck, productivity, ratio, stationLoad } from './production-efficiency'

export type RunTotal = { machineId: string | null; stage: 'printing' | 'press'; milliseconds: number; meter: number; count: number }
export type ShiftTotal = { stage: 'design' | 'printing' | 'press' | 'dtf'; manHours: number; peopleDays: number }
export type EfficiencyInputs = { runs: RunTotal[]; shifts: ShiftTotal[] }
type Process = 'sublim' | 'dtf' | 'press'

const HOUR = 3_600_000
const num = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const list = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : []
const id = (value: unknown) => value === null || value === undefined ? null : String(value)

/** The JSON of printex_efficiency_inputs; anything malformed is dropped. */
export function parseEfficiencyInputs(data: unknown): EfficiencyInputs {
  const value = (data ?? {}) as Record<string, unknown>
  return {
    runs: list(value.runs).filter(row => row.stage === 'printing' || row.stage === 'press').map(row => ({ machineId: id(row.machineId), stage: row.stage as RunTotal['stage'], milliseconds: num(row.milliseconds), meter: num(row.meter), count: num(row.count) })),
    shifts: list(value.shifts).filter(row => ['design', 'printing', 'press', 'dtf'].includes(String(row.stage))).map(row => ({ stage: row.stage as ShiftTotal['stage'], manHours: num(row.manHours), peopleDays: num(row.peopleDays) })),
  }
}

/**
 * Labour and machine productivity from finished runs (Mulai/Selesai cetak) and man-hours.
 * Output = meters of finished print runs (Sublim + DTF); press man-hours count as labour too.
 */
export function laborProductivity({ inputs, machineProcess }: { inputs: EfficiencyInputs | null; machineProcess: (machineId: string | null) => Process | null }) {
  if (!inputs) return null
  const meters = { sublim: 0, dtf: 0, press: 0 }, hours = { sublim: 0, dtf: 0, press: 0 }, counts = { sublim: 0, dtf: 0, press: 0 }
  for (const run of inputs.runs) {
    const process = run.stage === 'press' ? 'press' : machineProcess(run.machineId)
    if (!process) continue
    meters[process] += run.meter; hours[process] += run.milliseconds / HOUR; counts[process] += run.count
  }
  const manHours = { design: 0, printing: 0, press: 0, dtf: 0 }, peopleDays = { design: 0, printing: 0, press: 0, dtf: 0 }
  // (design man-hours are reported separately: design output is counted in orders)
  for (const shift of inputs.shifts) { manHours[shift.stage] += shift.manHours; peopleDays[shift.stage] += shift.peopleDays }
  const output = meters.sublim + meters.dtf
  const productionHours = manHours.printing + manHours.press + manHours.dtf
  return {
    output, orders: counts.sublim + counts.dtf, manHours: productionHours, designManHours: manHours.design, peopleDays: peopleDays.printing + peopleDays.press + peopleDays.dtf,
    perManHour: productivity(output, productionHours || null),
    perMachineHour: productivity(output, hours.sublim + hours.dtf || null),
    ordersPerOperatorDay: ratio(counts.sublim + counts.dtf, peopleDays.printing + peopleDays.press + peopleDays.dtf),
    stations: {
      sublim: { meter: meters.sublim, runHours: hours.sublim, manHours: manHours.printing, perMachineHour: productivity(meters.sublim, hours.sublim || null), perManHour: productivity(meters.sublim, manHours.printing || null) },
      press: { meter: meters.press, runHours: hours.press, manHours: manHours.press, perMachineHour: productivity(meters.press, hours.press || null), perManHour: productivity(meters.press, manHours.press || null) },
      dtf: { meter: meters.dtf, runHours: hours.dtf, manHours: manHours.dtf, perMachineHour: productivity(meters.dtf, hours.dtf || null), perManHour: productivity(meters.dtf, manHours.dtf || null) },
    },
  }
}
export type LaborProductivity = NonNullable<ReturnType<typeof laborProductivity>>

const STAGE_ORDER = ['incoming', 'design', 'design_done', 'printing', 'press', 'done', 'archive'] as const
type Stage = typeof STAGE_ORDER[number]
export type LoadOrder = { production_type: string; meter: number; order_date: string; board_stage: Stage; order_state: string; archive?: { finalizedAt?: string } | null }
export type StationId = 'design' | 'sublim' | 'press' | 'dtf'
const STATION_STAGE: Record<StationId, Stage> = { design: 'design', sublim: 'printing', press: 'press', dtf: 'printing' }
const isDtf = (order: LoadOrder) => order.production_type.trim().toUpperCase() === 'DTF'

/**
 * Load per station = (meters entering in the period + backlog not yet past the station) ÷ effective
 * capacity of the period. DTF orders load only DTF; other orders load Sublim and Press. Design is
 * measured in orders against its orders/day capacity. Menunggu Pembayaran is never a station.
 */
export function stationLoads({ orders, start, end, days, capacityPerDay, designPerDay, includeDesign }: {
  orders: readonly LoadOrder[]; start: string; end: string; days: number
  capacityPerDay: Record<'sublim' | 'press' | 'dtf', number | null>; designPerDay: number | null; includeDesign: boolean
}) {
  const stations: StationId[] = includeDesign && designPerDay ? ['design', 'sublim', 'press', 'dtf'] : ['sublim', 'press', 'dtf']
  const rows = stations.map(station => {
    const stage = STATION_STAGE[station]
    const relevant = orders.filter(order => order.order_state !== 'cancelled' && (station === 'design' || (station === 'dtf' ? isDtf(order) : !isDtf(order))))
    const waiting = (order: LoadOrder) => STAGE_ORDER.indexOf(order.board_stage) <= STAGE_ORDER.indexOf(stage) && order.order_state !== 'completed' && !order.archive?.finalizedAt
    const demandOrders = relevant.filter(order => (order.order_date >= start && order.order_date <= end) || (order.order_date < start && waiting(order)))
    // Design works per order regardless of length; production stations work per meter.
    const demand = station === 'design' ? demandOrders.length : demandOrders.reduce((sum, order) => sum + (Number.isFinite(order.meter) && order.meter > 0 ? order.meter : 0), 0)
    const perDay = station === 'design' ? designPerDay : capacityPerDay[station]
    const capacity = perDay === null ? null : perDay * days
    return { id: station, unit: station === 'design' ? 'order' as const : 'm' as const, demand, capacity, ...stationLoad(demand, capacity),
      wip: relevant.filter(order => order.board_stage === stage).length }
  })
  return { rows, bottleneck: findBottleneck(rows.map(row => ({ id: row.id, load: row.load }))) }
}
