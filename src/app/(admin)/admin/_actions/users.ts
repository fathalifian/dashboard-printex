'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACCESS_SCHEMA_VERSION, canAccessPage, canManageUsers } from '@/lib/access-control'

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(['owner', 'admin', 'operator']),
  active: z.boolean(),
})
const createSchema = profileSchema.extend({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128) })
async function authorize(selfOnlyAllowed = false) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile, error: profileError } = await client.from('profiles').select('full_name,role,is_active').eq('id', user.id).single()
  if (profileError || !profile?.is_active || (!selfOnlyAllowed && !canManageUsers(profile.role))) throw new Error('Hanya Owner yang dapat mengelola akun.')
  if (!canAccessPage(profile.role, '/settings/users')) throw new Error('Anda tidak memiliki akses Kelola Akun.')
  const { data: status, error: statusError } = await client.rpc('printex_online_status')
  if (statusError || status?.schema_version !== ACCESS_SCHEMA_VERSION) throw new Error('Struktur database belum diperbarui. Jalankan supabase/manual/1_RESET_STRUKTUR_DATABASE.sql terlebih dahulu.')
  return { client, user, profile }
}
function message(error: unknown) {
  if (error instanceof z.ZodError) return 'Data tidak valid. Isi nama, email, role, dan password minimal 8 karakter.'
  return error instanceof Error ? error.message : 'Permintaan gagal. Silakan coba lagi.'
}
export async function listManagedUsers() {
  try {
    const { client, user, profile } = await authorize(true)
    const ownAccount = { id: user.id, email: user.email ?? '', full_name: profile.full_name, role: profile.role, is_active: profile.is_active }
    if (!canManageUsers(profile.role)) return { users: [ownAccount], currentId: user.id, error: '' }
    const { data, error } = await client.rpc('printex_list_users')
    if (error) throw new Error('Daftar akun belum tersedia. Jalankan supabase/SETUP.sql di Supabase.')
    // The caller is listed once, with the profile that was just verified.
    const users = [...(data as { id: string }[]).filter(account => account.id !== user.id), ownAccount]
    return { users: users as Array<{ id: string; email: string; full_name: string; role: string; is_active: boolean }>, currentId: user.id, error: '' }
  } catch (error) { return { users: [], currentId: '', error: message(error) } }
}
export async function addManagedUser(input: unknown) {
  try {
    const { client, user } = await authorize()
    const values = createSchema.parse(input)
    // Check the database endpoint before creating an Auth account.
    const ready = await client.rpc('printex_list_users')
    if (ready.error) throw new Error('Daftar akun belum tersedia. Jalankan supabase/SETUP.sql di Supabase.')
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({ email: values.email, password: values.password, email_confirm: true, user_metadata: { full_name: values.fullName }, app_metadata: { provisioned_by:user.id } })
    if (error || !data.user) throw new Error(error?.message || 'Akun gagal dibuat.')
    const result = await client.rpc('printex_manage_user', { p_id:data.user.id,p_name:values.fullName,p_role:values.role,p_active:values.active,p_delete:false })
    if (result.error) {
      const cleanup = await admin.auth.admin.deleteUser(data.user.id)
      throw new Error(cleanup.error ? 'Profil gagal disimpan. Akun belum aktif; periksa daftar pengguna sebelum mencoba lagi.' : 'Profil gagal disimpan. Pembuatan akun dibatalkan.')
    }
    return { error: '' }
  } catch (error) { return { error: message(error) } }
}
export async function updateManagedUser(id: string, input: unknown) {
  try {
    const { client } = await authorize()
    z.uuid().parse(id)
    const values = profileSchema.parse(input)
    const { error } = await client.rpc('printex_manage_user', { p_id:id,p_name:values.fullName,p_role:values.role,p_active:values.active,p_delete:false })
    if (error) throw new Error(error.message)
    return { error: '' }
  } catch (error) { return { error: message(error) } }
}
export async function deleteManagedUser(id: string) {
  try {
    const { client, user } = await authorize()
    z.uuid().parse(id)
    if (id === user.id) throw new Error('Akun yang sedang digunakan tidak dapat dihapus.')
    const admin = createAdminClient()
    // Disable access atomically before removing login credentials. History is retained through nullable references.
    const { error } = await client.rpc('printex_manage_user', { p_id: id, p_name: null, p_role: null, p_active: false, p_delete: true })
    if (error) throw new Error(error.message)
    const result = await admin.auth.admin.deleteUser(id)
    if (result.error) throw new Error('Akses akun sudah dinonaktifkan, tetapi penghapusan login gagal. Coba hapus kembali.')
    return { error: '' }
  } catch (error) { return { error: message(error) } }
}
