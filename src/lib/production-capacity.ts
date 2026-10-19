// Kapasitas harian: K = P × T, dengan P = produktivitas terukur (meter / jam proses).
// Kapasitas efektif memakai T = jam tersedia − istirahat & setup; kapasitas desain memakai jam tersedia.
// Kapasitas stasiun = jumlah kapasitas mesinnya; lini Sublim → Press = nilai terendah.
import type { Machine, MachineKind } from './production-machines'

export type CapacityProcess = 'sublim' | 'dtf' | 'press'
export type CapacitySettings = {
  effective_hours: number; version: number
  /** shifts × shift hours; defaults to effective_hours, i.e. design = effective. */
  available_hours?: number
  shifts?: number; shift_hours?: number; planned_downtime_minutes?: number; design_orders_per_hour?: number | null
  /** Standard crew per day (people); man-hours = crew × effective hours unless a day is overridden. */
  crew?: Crew
}
export type ProcessMeasure = { meter: number; milliseconds: number; count: number }
export type CrewStage = 'printing' | 'dtf' | 'press' | 'design'
export type Crew = Record<CrewStage, number>
export const CREW_STAGES: readonly CrewStage[] = ['printing', 'dtf', 'press', 'design']
// Fedar 1 per machine (2 machines), DTF 1 per machine, Press 3 per machine, 1 designer.
export const DEFAULT_CREW: Crew = { printing: 2, dtf: 1, press: 3, design: 1 }
type MachineCapacity = {
  id: string; name: string; process: CapacityProcess
  meter: number; hours: number; count: number
  productivity: number | null
  /** false when the machine has no own data in the period and uses its station average. */
  measured: boolean
  /** Effective capacity per day (K) and design capacity per day. */
  capacity: number | null
  designCapacity: number | null
}
type ProcessCapacity = {
  meter: number; hours: number; count: number
  productivity: number | null
  machines: number
  capacity: number | null
  designCapacity: number | null
  dailyOutput: number
  /** Daily output ÷ design capacity. */
  utilization: number | null
  /** Daily output ÷ effective capacity. */
  efficiency: number | null
}
export type CapacityResult = {
  processes: Record<CapacityProcess, ProcessCapacity>
  machines: MachineCapacity[]
  effectiveHours: number
  availableHours: number
  /** bottleneck = the station that limits line capacity (the load-based bottleneck is computed separately). */
  system: { capacity: number | null; designCapacity: number | null; bottleneck: 'sublim' | 'press' | null; dailyOutput: number; utilization: number | null; efficiency: number | null }
}

export const DEFAULT_EFFECTIVE_HOURS = 7
export const CAPACITY_PROCESSES: readonly CapacityProcess[] = ['sublim', 'dtf', 'press']
export const PROCESS_MACHINE_KIND: Record<CapacityProcess, MachineKind> = { sublim: 'fedar', dtf: 'dtf', press: 'press' }
/** The standard working time: 1 shift of 9 hours with 2 hours break & setup. */
export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = {
  version: 1, shifts: 1, shift_hours: 9, planned_downtime_minutes: 120, available_hours: 9, effective_hours: DEFAULT_EFFECTIVE_HOURS,
  design_orders_per_hour: null, crew: DEFAULT_CREW,
}
/** The standard machines, used until the machine list has loaded. */
export const defaultMachines = (): Machine[] => [
  { id: 'default:fedar:1', kind: 'fedar', name: 'Fedar 1' },
  { id: 'default:fedar:2', kind: 'fedar', name: 'Fedar 2' },
  { id: 'default:dtf:1', kind: 'dtf', name: 'DTF 1' },
  { id: 'default:press:1', kind: 'press', name: 'Press 1' },
]

const decimal = (value: unknown) => Number(String(value ?? '').replace(',', '.'))

export function validateCapacitySettings(input: CapacitySettings): CapacitySettings {
  if (!Number.isSafeInteger(input?.version) || input.version < 1) throw new Error('Versi pengaturan tidak valid. Muat ulang halaman.')
  const shifts = Number(input.shifts ?? 1), shiftHours = decimal(input.shift_hours), downtime = decimal(input.planned_downtime_minutes ?? 0)
  if (!Number.isInteger(shifts) || shifts < 1 || shifts > 3) throw new Error('Jumlah shift 1 sampai 3.')
  if (!Number.isFinite(shiftHours) || shiftHours <= 0 || shifts * shiftHours > 24) throw new Error('Jam kerja tersedia (shift × jam per shift) harus lebih dari 0 dan maksimal 24 jam.')
  if (!Number.isInteger(downtime) || downtime < 0) throw new Error('Istirahat & setup diisi dalam menit bulat, minimal 0.')
  const available = shifts * Math.round(shiftHours * 100) / 100
  const effective = Math.round((available - downtime / 60) * 100) / 100
  if (effective <= 0) throw new Error('Istirahat & setup harus lebih kecil dari jam kerja tersedia.')
  const design = input.design_orders_per_hour === null || input.design_orders_per_hour === undefined || String(input.design_orders_per_hour).trim() === '' ? null : decimal(input.design_orders_per_hour)
  if (design !== null && (!Number.isFinite(design) || design <= 0 || design > 1000)) throw new Error('Kecepatan desain harus lebih dari 0 order/jam, atau dikosongkan.')
  const crew = { ...DEFAULT_CREW, ...input.crew }
  for (const stage of CREW_STAGES) if (!Number.isInteger(crew[stage]) || crew[stage] < 0 || crew[stage] > 50) throw new Error('Jumlah operator 0 sampai 50 orang.')
  return { version: input.version, shifts, shift_hours: Math.round(shiftHours * 100) / 100, planned_downtime_minutes: downtime,
    available_hours: available, effective_hours: effective, design_orders_per_hour: design === null ? null : Math.round(design * 100) / 100, crew }
}

/** The production_settings row. */
export function parseCapacityRow(row: Record<string, unknown>): CapacitySettings {
  return validateCapacitySettings({ version: Number(row.version), effective_hours: Number(row.effective_hours), shifts: Number(row.shifts), shift_hours: Number(row.shift_hours),
    planned_downtime_minutes: Number(row.planned_downtime_minutes), design_orders_per_hour: row.design_orders_per_hour === null || row.design_orders_per_hour === undefined ? null : Number(row.design_orders_per_hour),
    crew: { printing: Number(row.operators_printing ?? DEFAULT_CREW.printing), dtf: Number(row.operators_dtf ?? DEFAULT_CREW.dtf), press: Number(row.operators_press ?? DEFAULT_CREW.press), design: Number(row.operators_design ?? DEFAULT_CREW.design) } })
}

export function daysInRange(start: string, end: string) {
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1
  return Number.isFinite(days) && days > 0 ? days : 0
}

const productivityOf = (measure?: ProcessMeasure) =>
  measure && measure.meter > 0 && measure.milliseconds > 0 ? measure.meter / (measure.milliseconds / 3_600_000) : null

/** Capacity per machine, station and Sublim → Press line for one period. */
export function productionCapacity({ stations, machines, machineMeasures, settings, days }: {
  stations: Partial<Record<CapacityProcess, ProcessMeasure>>
  machines: readonly Machine[]
  machineMeasures: ReadonlyMap<string, ProcessMeasure>
  settings: CapacitySettings
  days: number
}): CapacityResult {
  const T = settings.effective_hours, A = settings.available_hours ?? T
  const machineRows: MachineCapacity[] = []
  const processes = Object.fromEntries(CAPACITY_PROCESSES.map(process => {
    const station = stations[process]
    const stationP = productivityOf(station)
    const list = machines.filter(machine => machine.kind === PROCESS_MACHINE_KIND[process])
    // No machines means zero capacity; machines without any data mean unknown, never zero.
    let capacity: number | null = list.length ? null : 0, designCapacity: number | null = list.length ? null : 0
    for (const machine of list) {
      // Press is not assigned per order; every press machine uses the station P.
      const own = process === 'press' ? undefined : machineMeasures.get(machine.id)
      const ownP = productivityOf(own)
      const productivity = ownP ?? stationP
      const machineCapacity = productivity === null ? null : productivity * T
      const machineDesign = productivity === null ? null : productivity * A
      if (machineCapacity !== null) capacity = (capacity ?? 0) + machineCapacity
      if (machineDesign !== null) designCapacity = (designCapacity ?? 0) + machineDesign
      machineRows.push({
        id: machine.id, name: machine.name, process,
        meter: own?.meter ?? 0, hours: (own?.milliseconds ?? 0) / 3_600_000, count: own?.count ?? 0,
        productivity, measured: ownP !== null, capacity: machineCapacity, designCapacity: machineDesign,
      })
    }
    const meter = station?.meter ?? 0, hours = (station?.milliseconds ?? 0) / 3_600_000
    const dailyOutput = days > 0 ? meter / days : 0
    return [process, {
      meter, hours, count: station?.count ?? 0,
      productivity: hours > 0 && meter > 0 ? meter / hours : null,
      machines: list.length, capacity, designCapacity, dailyOutput,
      utilization: designCapacity ? dailyOutput / designCapacity : null,
      efficiency: capacity ? dailyOutput / capacity : null,
    }]
  })) as Record<CapacityProcess, ProcessCapacity>
  const sublim = processes.sublim, press = processes.press
  const line = sublim.capacity !== null && press.capacity !== null
  const systemCapacity = line ? Math.min(sublim.capacity!, press.capacity!) : null
  const systemDesign = line ? Math.min(sublim.designCapacity ?? 0, press.designCapacity ?? 0) : null
  // Every finished sublim meter is pressed, so system output follows sublim print output.
  const dailyOutput = sublim.dailyOutput
  return {
    processes,
    machines: machineRows,
    effectiveHours: T,
    availableHours: A,
    system: {
      capacity: systemCapacity,
      designCapacity: systemDesign,
      bottleneck: line ? (sublim.capacity! <= press.capacity! ? 'sublim' : 'press') : null,
      dailyOutput,
      utilization: systemDesign ? dailyOutput / systemDesign : null,
      efficiency: systemCapacity ? dailyOutput / systemCapacity : null,
    },
  }
}
