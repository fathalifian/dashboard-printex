'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function updateOwnAccount(input: unknown) {
  const parsed = z.object({ fullName: z.string().trim().min(1).max(100) }).safeParse(input)
  if (!parsed.success) return { error: 'Isi nama dengan 1–100 karakter.' }
  try {
    const client = await createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return { error: 'Silakan login kembali.' }
    // The authenticated user determines the target; only the name is writable.
    const admin = createAdminClient()
    const result = await admin.from('profiles')
      .update({ full_name: parsed.data.fullName, updated_at: new Date().toISOString() })
      .eq('id', user.id).eq('is_active', true).select('id').single()
    if (result.error) return { error: 'Nama belum dapat disimpan. Pastikan akun masih aktif dan coba lagi.' }
    return { error: '' }
  } catch {
    return { error: 'Permintaan gagal. Periksa koneksi dan coba lagi.' }
  }
}
