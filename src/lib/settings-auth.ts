import { createClient } from '@/lib/supabase/server'
import { canManageOrders, normalizeRole } from '@/lib/access-control'

/** Server-side check for settings actions: a signed-in, active account; writes need Owner or Admin. RLS still applies. */
export async function authorizeSettings(write = false) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (!profile?.is_active || !normalizeRole(profile.role)) throw new Error('Akun tidak memiliki akses.')
  if (write && !canManageOrders(profile.role)) throw new Error('Hanya Admin dan Owner yang dapat mengubah pengaturan.')
  return { client }
}
