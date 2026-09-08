'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(['superadmin', 'admin', 'staff']),
  active: z.boolean(),
})
const createSchema = profileSchema.extend({ email: z.string().trim().email().max(254), password: z.string().min(12).max(128) })
async function authorize() {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (profileError || !profile?.is_active || profile.role !== 'superadmin') throw new Error('Hanya Super Admin yang dapat mengelola akun.')
  return { client, user }
}
function message(error: unknown) {
  if (error instanceof z.ZodError) return 'Data tidak valid. Isi nama, email, role, dan password minimal 12 karakter.'
  return error instanceof Error ? error.message : 'Permintaan gagal. Silakan coba lagi.'
}
export async function listManagedUsers() {
  try {
    const { client, user } = await authorize()
    const { data, error } = await client.rpc('printex_list_users')
    if (error) throw new Error('Daftar akun belum tersedia. Jalankan migrasi manajemen user 0011.')
    return { users: data as Array<{ id: string; email: string; full_name: string; role: string; is_active: boolean }>, currentId: user.id, error: '' }
  } catch (error) { return { users: [], currentId: '', error: message(error) } }
}
export async function addManagedUser(input: unknown) {
  try {
    const { client } = await authorize()
    const values = createSchema.parse(input)
    // Check the database endpoint before creating an Auth account.
    const ready = await client.rpc('printex_list_users')
    if (ready.error) throw new Error('Jalankan migrasi manajemen user 0011 terlebih dahulu.')
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({ email: values.email, password: values.password, email_confirm: true, user_metadata: { full_name: values.fullName } })
    if (error || !data.user) throw new Error(error?.message || 'Akun gagal dibuat.')
    const result = await client.rpc('printex_manage_user', { p_id: data.user.id, p_name: values.fullName, p_role: values.role, p_active: values.active, p_delete: false })
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
    const { error } = await client.rpc('printex_manage_user', { p_id: id, p_name: values.fullName, p_role: values.role, p_active: values.active, p_delete: false })
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
