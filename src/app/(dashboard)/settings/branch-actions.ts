'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function authorize() {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (!profile?.is_active || profile.role !== 'central_owner') throw new Error('Hanya Owner Pusat yang dapat mengelola cabang.')
  return client
}
function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return 'Isi nama cabang dengan 1–100 karakter.'
  return error instanceof Error ? error.message : 'Permintaan gagal. Coba lagi.'
}
async function call(client: Awaited<ReturnType<typeof createClient>>, action: string, id?: string, name?: string) {
  const { data, error } = await client.rpc('printex_manage_branch', { p_action: action, p_id: id ?? null, p_name: name ?? null })
  if (error) throw new Error(error.code === 'PGRST202' || error.code === '42883' ? 'Kelola Cabang belum aktif. Jalankan migrasi 0008_branch_management.sql terlebih dahulu.' : error.message)
  return data
}
export async function listBranches() {
  try {
    const client = await authorize()
    return { branches: await call(client, 'list') as { id: string; name: string; deleting: boolean }[], error: '' }
  } catch (error) { return { branches: [], error: errorMessage(error) } }
}
export async function saveBranch(input: unknown) {
  try {
    const client = await authorize()
    const values = z.object({ action: z.enum(['create', 'rename', 'delete']), id: z.uuid(), name: z.string().trim().min(1).max(100) }).parse(input)
    if (values.action !== 'delete') await call(client, values.action, values.id, values.name)
    else {
      // Verify server credentials before freezing a branch. The durable job allows safe retries.
      const admin = createAdminClient()
      const job = await call(client, 'prepare_delete', values.id, values.name) as { photo_paths: string[]; user_ids: string[] }
      for (let index = 0; index < job.photo_paths.length; index += 100) {
        const { error } = await admin.storage.from('order-photos').remove(job.photo_paths.slice(index, index + 100))
        if (error) throw new Error('Pembersihan file belum selesai. Klik Lanjutkan Hapus untuk mencoba lagi.')
      }
      for (const id of job.user_ids) {
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error && error.code !== 'user_not_found' && error.status !== 404) throw new Error('Pembersihan akun belum selesai. Klik Lanjutkan Hapus untuk mencoba lagi.')
      }
      await call(client, 'finish_delete', values.id, values.name)
    }
    return { error: '' }
  } catch (error) { return { error: errorMessage(error) } }
}
