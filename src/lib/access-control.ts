import type { ProcessStage } from './process-metrics'

export const ACCESS_SCHEMA_VERSION = 8
export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', operator: 'Operator' } as const
export type Role = keyof typeof ROLE_LABELS

// Read legacy names during migration; new accounts always use canonical roles.
export function normalizeRole(role: unknown): Role | null {
  if (role === 'superadmin') return 'owner'
  if (role === 'staff') return 'operator'
  return role === 'owner' || role === 'admin' || role === 'operator' ? role : null
}
export function roleLabel(role: unknown) {
  const normalized = normalizeRole(role)
  return normalized ? ROLE_LABELS[normalized] : 'Memuat profil'
}
export function canManageOrders(role: unknown) {
  const normalized = normalizeRole(role)
  return normalized === 'owner' || normalized === 'admin'
}
export function canManageUsers(role: unknown) { return normalizeRole(role) === 'owner' }

export const OPERATOR_STAGES: readonly ProcessStage[] = ['design_done', 'printing', 'press', 'done']
export function canDragStage(role: unknown, stage: ProcessStage) {
  return stage !== 'archive' && (canManageOrders(role) || (normalizeRole(role) === 'operator' && OPERATOR_STAGES.includes(stage)))
}
// The existing production workflow additionally checks adjacency and DTF skips.
export function canMoveBetweenStages(role: unknown, from: ProcessStage, to: ProcessStage) {
  return canManageOrders(role) || (normalizeRole(role) === 'operator' && OPERATOR_STAGES.includes(from) && OPERATOR_STAGES.includes(to))
}
export function canAccessPage(role: unknown, pathname: string) {
  const normalized = normalizeRole(role)
  if (!normalized) return false
  const path = pathname.replace(/\/+$/, '') || '/'
  if (normalized === 'operator') return ['/', '/dashboard', '/schedule'].includes(path)
  if (path === '/settings/users' || path.startsWith('/settings/users/')) return normalized === 'owner'
  return true
}
