'use server'

import { authorizeBranchSettings } from '@/lib/branch-settings'
import { validateStockShortcut, type StockShortcut } from '@/lib/stock-shortcuts'

export async function getStockShortcuts(selectedBranch?: string | null) {
  try {
    const { client, branchId } = await authorizeBranchSettings(selectedBranch)
    let query = client.from(branchId ? 'branch_stock_shortcuts' : 'stock_shortcuts').select('id,label,url,version')
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query.order('id')
    if (error || data?.length !== 2) throw new Error('Pengaturan shortcut belum tersedia. Hubungi pengelola website.')
    return { shortcuts: data.map(row => validateStockShortcut(row as StockShortcut)), error: '' }
  } catch (error) {
    return { shortcuts: null, error: error instanceof Error ? error.message : 'Shortcut belum dapat dimuat.' }
  }
}

export async function saveStockShortcut(input: StockShortcut, selectedBranch?: string | null) {
  try {
    const { client, branchId } = await authorizeBranchSettings(selectedBranch, true)
    const shortcut = validateStockShortcut(input)
    let query = client.from(branchId ? 'branch_stock_shortcuts' : 'stock_shortcuts')
      .update({ label: shortcut.label, url: shortcut.url, version: shortcut.version + 1 })
      .eq('id', shortcut.id).eq('version', shortcut.version)
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query.select('id,label,url,version').maybeSingle()
    if (error) throw new Error('Shortcut belum tersimpan. Periksa koneksi dan ketersediaan pengaturan shortcut.')
    if (!data) {
      let currentQuery = client.from(branchId ? 'branch_stock_shortcuts' : 'stock_shortcuts').select('id,label,url,version').eq('id', shortcut.id)
      if (branchId) currentQuery = currentQuery.eq('branch_id', branchId)
      const current = await currentQuery.maybeSingle()
      if (current.error || !current.data) throw new Error('Shortcut belum tersedia. Muat ulang dan coba lagi.')
      const latest = validateStockShortcut(current.data as StockShortcut)
      // A retry after a lost response can safely acknowledge the same saved values.
      if (latest.label === shortcut.label && latest.url === shortcut.url) return { shortcut: latest, error: '' }
      return { shortcut: null, latest, error: 'Shortcut telah diubah. Muat data terbaru sebelum mengedit kembali.' }
    }
    return { shortcut: validateStockShortcut(data as StockShortcut), error: '' }
  } catch (error) {
    return { shortcut: null, error: error instanceof Error ? error.message : 'Shortcut belum tersimpan.' }
  }
}
