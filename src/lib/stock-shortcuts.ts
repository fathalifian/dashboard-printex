export type StockShortcut = { id: 'dtf_paper' | 'fabric'; label: string; url: string; version: number }
export const DEFAULT_STOCK_SHORTCUTS: StockShortcut[] = [
  { id: 'dtf_paper', label: 'Stock DTF dan Kertas', url: 'https://docs.google.com/spreadsheets/d/1qSXiNUIUOmJ_yPmtpB8CLEEk2OZCHMRkhH7m6b1NPM8/edit?gid=143541986#gid=143541986', version: 1 },
  { id: 'fabric', label: 'Stock Kain', url: 'https://docs.google.com/spreadsheets/d/1Ipag7VfEh8yyEBjhU52dL0TlE9bfh4lhcwow8CZ_HJA/edit?gid=255000558#gid=255000558', version: 1 },
]

export function validateStockShortcut(input: StockShortcut): StockShortcut {
  if (!input || !['dtf_paper', 'fabric'].includes(input.id)) throw new Error('Shortcut tidak valid.')
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 60) throw new Error('Nama tombol wajib diisi, maksimal 60 karakter.')
  if (typeof input.url !== 'string' || input.url.length > 2048) throw new Error('Link tidak valid, maksimal 2.048 karakter.')
  let url: URL
  try { url = new URL(input.url.trim()) } catch { throw new Error('Masukkan link lengkap dengan https://.') }
  if (url.protocol !== 'https:' || url.username || url.password || /\s/.test(input.url.trim())) throw new Error('Gunakan link HTTPS yang valid tanpa informasi login.')
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error('Versi shortcut tidak valid. Muat ulang halaman.')
  return { id: input.id, label: input.label.trim(), url: url.href, version: input.version }
}
