// Rumus kapasitas, efisiensi, produktivitas, dan bottleneck. Fungsi murni: tanpa React
// atau Supabase. Nilai yang tidak dapat dihitung (data kosong, pembagi 0) = null.

export type WorkingTime = { shifts: number; shiftHours: number; plannedDowntimeMinutes: number }

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** num ÷ den, or null when either side is missing or the divisor is not positive. */
export function ratio(num: number | null | undefined, den: number | null | undefined) {
  return finite(num) && finite(den) && den > 0 ? num / den : null
}

/** Rounds without floating-point noise: 71.25 → 71.3 (not 71.2). */
export function roundTo(value: number, digits = 1) {
  const clean = Number(value.toPrecision(12))
  return Number(`${Math.round(Number(`${clean}e${digits}`))}e-${digits}`)
}
export const percent = (value: number | null, digits = 1) => value === null ? null : roundTo(value * 100, digits)

/** Available = shifts × hours per shift; effective = available − break and setup time. */
export function workingHours({ shifts, shiftHours, plannedDowntimeMinutes }: WorkingTime) {
  const available = shifts * shiftHours
  const effective = available - plannedDowntimeMinutes / 60
  return { available, plannedDowntime: plannedDowntimeMinutes / 60, effective: effective > 0 ? effective : null }
}

/** Design = productivity × available hours × days; effective = productivity × effective hours × days. */
export function capacityFor({ speed, availableHours, effectiveHours, days }: { speed: number | null; availableHours: number; effectiveHours: number | null; days: number }) {
  if (!finite(speed) || speed <= 0 || days <= 0) return { design: null, effective: null }
  return { design: speed * availableHours * days, effective: finite(effectiveHours) ? speed * effectiveHours * days : null }
}

/** Utilization against design capacity, efficiency (actual ÷ effective capacity), and what is left after the load. */
export function capacityUse({ output, design, effective, load = null }: { output: number; design: number | null; effective: number | null; load?: number | null }) {
  return {
    utilization: ratio(output, design),
    efficiency: ratio(output, effective),
    remaining: finite(effective) && finite(load) ? effective - load : null,
  }
}

/** Sublim → Press: the smaller effective capacity limits the line. */
export function lineCapacity(sublim: number | null, press: number | null) {
  if (!finite(sublim) || !finite(press)) return { capacity: null, limiter: null }
  return { capacity: Math.min(sublim, press), limiter: sublim <= press ? 'sublim' as const : 'press' as const }
}

/** Load = demand ÷ effective capacity; above 100% the station cannot keep up. */
export function stationLoad(demand: number, capacity: number | null) {
  const load = ratio(demand, capacity)
  return { load, critical: load !== null && load > 1 }
}

/** The station with the highest load; ties keep the first (upstream) station. */
export function findBottleneck<T extends string>(loads: readonly { id: T; load: number | null }[]) {
  let best: { id: T; load: number } | null = null
  for (const item of loads) if (item.load !== null && (best === null || item.load > best.load)) best = { id: item.id, load: item.load }
  return best
}

/** Output ÷ hours (machine running hours or operator man-hours). */
export const productivity = (output: number, hours: number | null) => output > 0 ? ratio(output, hours) : null

/** (current − previous) ÷ previous; null without a positive previous value. */
export function growth(current: number | null, previous: number | null) {
  return finite(current) && finite(previous) && previous > 0 ? (current - previous) / previous : null
}

/** The period of the same length that ends the day before `start` (YYYY-MM-DD). */
export function previousPeriod(start: string, end: string) {
  const day = 86_400_000
  const from = Date.parse(`${start}T12:00:00Z`), to = Date.parse(`${end}T12:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  const length = Math.round((to - from) / day) + 1
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
  return { start: iso(from - length * day), end: iso(from - day) }
}
