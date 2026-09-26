'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACCESS_SCHEMA_VERSION, canManageUsers } from '@/lib/access-control'

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(['central_owner', 'owner', 'admin', 'operator']),
  active: z.boolean(),
  branchId: z.string().uuid().optional(),
})
const createSchema = profileSchema.extend({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128) })
async function authorize() {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active,branch_id').eq('id', user.id).single()
  if (profileError || !profile?.is_active || !canManageUsers(profile.role)) throw new Error('Hanya Owner yang dapat mengelola akun.')
  const { data: status, error: statusError } = await client.rpc('printex_online_status')
  if (statusError || status?.schema_version !== ACCESS_SCHEMA_VERSION) throw new Error('Jalankan migrasi 0013_owner_operator_permissions.sql terlebih dahulu.')

  return { client, user, profile, multiBranch: status?.branches_enabled === true }
}
function message(error: unknown) {
  if (error instanceof z.ZodError) return 'Data tidak valid. Isi nama, email, role, dan password minimal 8 karakter.'
  return error instanceof Error ? error.message : 'Permintaan gagal. Silakan coba lagi.'
}
export async function listManagedUsers(branchId?: string | null) {
  try {
    const { client, user, multiBranch } = await authorize()
    const { data, error } = await client.rpc('printex_list_users')
    if (error) throw new Error(multiBranch ? 'Jalankan ENABLE_BRANCH_OWNER_USERS.sql untuk mengaktifkan pengelolaan akun cabang.' : 'Daftar akun belum tersedia. Jalankan migrasi manajemen user 0011.')
    let users = data
    if (multiBranch) {
      const profiles = await client.from('profiles').select('id,branch_id')
      if (profiles.error) throw profiles.error
      users = data.map((account: {id:string}) => ({...account,branch_id:profiles.data.find(p=>p.id===account.id)?.branch_id}))
    }
    if (multiBranch && branchId) users = users.filter((account: { branch_id?: string }) => account.branch_id === branchId)
    return { users: users as Array<{ id: string; email: string; full_name: string; role: string; is_active: boolean; branch_id?: string }>, currentId: user.id, error: '' }
  } catch (error) { return { users: [], currentId: '', error: message(error) } }
}
export async function addManagedUser(input: unknown) {
  try {
    const { client, user, profile, multiBranch } = await authorize()
    const values = createSchema.parse(input)
    if (values.role === 'central_owner' && !multiBranch) throw new Error('Aktifkan uji coba cabang terlebih dahulu.')
    if (multiBranch && values.role !== 'central_owner' && !values.branchId) throw new Error('Pilih cabang akun.')
    if (multiBranch && profile.role === 'owner' && (!['admin','operator'].includes(values.role) || values.branchId !== profile.branch_id)) throw new Error('Pilih Admin atau Operator untuk cabang Anda.')
    // Check the database endpoint before creating an Auth account.
    const ready = await client.rpc('printex_list_users')
    if (ready.error) throw new Error(multiBranch ? 'Jalankan ENABLE_BRANCH_OWNER_USERS.sql terlebih dahulu.' : 'Jalankan migrasi manajemen user 0011 terlebih dahulu.')
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({ email: values.email, password: values.password, email_confirm: true, user_metadata: { full_name: values.fullName }, app_metadata: { provisioned_by:user.id, provisioned_branch:values.branchId ?? null } })
    if (error || !data.user) throw new Error(error?.message || 'Akun gagal dibuat.')
    const result = await client.rpc(multiBranch ? 'printex_manage_branch_user' : 'printex_manage_user', {
      p_id:data.user.id,p_name:values.fullName,p_role:values.role,p_active:values.active,
      ...(multiBranch ? {p_branch:values.branchId ?? null} : {p_delete:false})
    })
    if (result.error) {
      const cleanup = await admin.auth.admin.deleteUser(data.user.id)
      throw new Error(cleanup.error ? 'Profil gagal disimpan. Akun belum aktif; periksa daftar pengguna sebelum mencoba lagi.' : 'Profil gagal disimpan. Pembuatan akun dibatalkan.')
    }
    return { error: '' }
  } catch (error) { return { error: message(error) } }
}
export async function updateManagedUser(id: string, input: unknown) {
  try {
    const { client, multiBranch } = await authorize()
    z.uuid().parse(id)
    const values = profileSchema.parse(input)
    const { error } = await client.rpc(multiBranch ? 'printex_manage_branch_user' : 'printex_manage_user', {
      p_id:id,p_name:values.fullName,p_role:values.role,p_active:values.active,
      ...(multiBranch ? {p_branch:values.branchId ?? null} : {p_delete:false})
    })
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
