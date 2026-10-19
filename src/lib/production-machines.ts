export type MachineKind = 'fedar' | 'dtf' | 'press'
export type Machine = { id: string; kind: MachineKind; name: string }

export const MACHINE_KINDS: readonly MachineKind[] = ['fedar', 'dtf', 'press']
export const MACHINE_KIND_LABEL: Record<MachineKind, string> = { fedar: 'Fedar (Sublim)', dtf: 'DTF', press: 'Press' }
// Print stations that must keep at least one machine so orders can enter Proses Sublim.
export const REQUIRED_PRINT_KINDS: readonly MachineKind[] = ['fedar', 'dtf']

export const isDtf = (productionType: string) => productionType.trim().toUpperCase() === 'DTF'
// DTF material prints only on DTF machines; every other material prints on Fedar.
export const printMachineKind = (productionType: string): MachineKind => isDtf(productionType) ? 'dtf' : 'fedar'

export function printMachinesFor(machines: readonly Machine[], productionType: string) {
  const kind = printMachineKind(productionType)
  return machines.filter(machine => machine.kind === kind)
}

export function validateMachineName(name: unknown, existing: readonly Machine[] = [], ignoreId?: string) {
  if (typeof name !== 'string') throw new Error('Nama mesin wajib diisi.')
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value || value.length > 40) throw new Error('Nama mesin wajib diisi, maksimal 40 karakter.')
  if (existing.some(machine => machine.id !== ignoreId && machine.name.toLowerCase() === value.toLowerCase())) throw new Error(`Nama "${value}" sudah dipakai mesin lain.`)
  return value
}

export function canRemoveMachine(machines: readonly Machine[], machine: Machine) {
  return !REQUIRED_PRINT_KINDS.includes(machine.kind) || machines.filter(item => item.kind === machine.kind).length > 1
}

export function nextMachineName(machines: readonly Machine[], kind: MachineKind) {
  const base = kind === 'fedar' ? 'Fedar' : kind === 'dtf' ? 'DTF' : 'Press'
  for (let index = 1; ; index++) {
    const name = `${base} ${index}`
    if (!machines.some(machine => machine.name.toLowerCase() === name.toLowerCase())) return name
  }
}

export function parseMachineRow(row: Record<string, unknown>): Machine | null {
  const kind = String(row.kind) as MachineKind
  if (!MACHINE_KINDS.includes(kind) || !row.id || typeof row.name !== 'string') return null
  return { id: String(row.id), kind, name: row.name }
}
