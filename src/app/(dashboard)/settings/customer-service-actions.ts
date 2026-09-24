'use server'

import { createClient } from '@/lib/supabase/server'
import { canManageOrders, normalizeRole } from '@/lib/access-control'
import { normalizeWhatsAppNumber } from '@/lib/customer-service'

async function authorize(write = false) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new Error('Silakan login kembali.')
  const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  if (profileError || !profile?.is_active || !normalizeRole(profile.role)) throw new Error('Akun tidak memiliki akses.')
  if (write && !canManageOrders(profile.role)) throw new Error('Hanya Admin dan Owner yang dapat mengubah nomor Customer Service.')
  return client
}

export async function getCustomerService() {
  try {
    const client = await authorize()
    const { data, error } = await client.from('customer_service_settings').select('whatsapp_number').eq('singleton', true).single()
    if (error) throw new Error('Pengaturan Customer Service belum tersedia. Hubungi pengelola website.')
    return { number: data.whatsapp_number as string, error: '' }
  } catch (error) {
    return { number: '', error: error instanceof Error ? error.message : 'Nomor Customer Service belum dapat dimuat.' }
  }
}

export async function saveCustomerService(input: string) {
  try {
    const client = await authorize(true)
    if (typeof input !== 'string') throw new Error('Nomor WhatsApp tidak valid.')
    const number = normalizeWhatsAppNumber(input)
    const { data, error } = await client.from('customer_service_settings').update({ whatsapp_number: number }).eq('singleton', true).select('whatsapp_number').single()
    if (error) throw new Error('Nomor belum tersimpan. Periksa koneksi dan ketersediaan pengaturan Customer Service.')
    return { number: data.whatsapp_number as string, error: '' }
  } catch (error) {
    return { number: '', error: error instanceof Error ? error.message : 'Nomor Customer Service belum dapat disimpan.' }
  }
}
