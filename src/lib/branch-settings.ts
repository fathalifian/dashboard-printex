import { createClient } from '@/lib/supabase/server'
import { canManageOrders, normalizeRole } from '@/lib/access-control'

export async function authorizeBranchSettings(branchId?: string | null, write = false) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (!profile?.is_active || !normalizeRole(profile.role)) throw new Error('Akun tidak memiliki akses.')
  if (write && !canManageOrders(profile.role)) throw new Error('Hanya Admin dan Owner yang dapat mengubah pengaturan.')
  const { data: status, error: statusError } = await client.rpc('printex_online_status')
  if (statusError) throw new Error('Status cabang belum dapat dimuat.')
  if (status?.branches_enabled) {
    if (!branchId || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(branchId)) throw new Error('Pilih satu cabang untuk membuka pengaturannya.')
    const { data: allowed, error: accessError } = await client.rpc('printex_branch_access', { p_branch: branchId })
    if (accessError || !allowed) throw new Error('Anda tidak memiliki akses ke cabang ini.')
    return { client, branchId }
  }
  return { client, branchId: null }
}
