'use server'

import { createClient } from '@/lib/supabase/server'
import { canManageOrders, normalizeRole } from '@/lib/access-control'
import { validateStockShortcut, type StockShortcut } from '@/lib/stock-shortcuts'

async function authorize(write = false) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (profileError || !profile?.is_active || !normalizeRole(profile.role)) throw new Error('Akun tidak memiliki akses.')
  if (write && !canManageOrders(profile.role)) throw new Error('Hanya akun Owner dan Admin yang dapat mengubah shortcut.')
  return client
}

export async function getStockShortcuts() {
  try {
    const client = await authorize()
    const { data, error } = await client.from('stock_shortcuts').select('id,label,url,version').order('id')
    if (error || data?.length !== 2) throw new Error('Pengaturan shortcut belum tersedia. Hubungi pengelola website.')
    return { shortcuts: data.map(row => validateStockShortcut(row as StockShortcut)), error: '' }
  } catch (error) {
    return { shortcuts: null, error: error instanceof Error ? error.message : 'Shortcut belum dapat dimuat.' }
  }
}

export async function saveStockShortcut(input: StockShortcut) {
  try {
    const client = await authorize(true)
    const shortcut = validateStockShortcut(input)
    const { data, error } = await client.from('stock_shortcuts')
      .update({ label: shortcut.label, url: shortcut.url, version: shortcut.version + 1 })
      .eq('id', shortcut.id).eq('version', shortcut.version).select('id,label,url,version').maybeSingle()
    if (error) throw new Error('Shortcut belum tersimpan. Periksa koneksi dan ketersediaan pengaturan shortcut.')
    if (!data) throw new Error('Shortcut telah berubah. Muat ulang halaman sebelum mencoba lagi.')
    return { shortcut: validateStockShortcut(data as StockShortcut), error: '' }
  } catch (error) {
    return { shortcut: null, error: error instanceof Error ? error.message : 'Shortcut belum tersimpan.' }
  }
}
