export function supabaseConfig() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if(!url||!key) throw new Error('Konfigurasi Supabase belum lengkap. Isi URL dan publishable key pada environment.')
  return {url,key}
}
