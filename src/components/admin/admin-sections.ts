import { Clock3, HardHat, LayoutGrid, MessageCircle, Printer, Sheet, UserRound, Users, type LucideIcon } from 'lucide-react'
import { normalizeRole } from '@/lib/access-control'

export type AdminSectionId = 'ringkasan' | 'akun' | 'mesin' | 'waktu-kerja' | 'jam-operator' | 'link-stok' | 'customer-service' | 'profil'
export type AdminSection = {
  id: AdminSectionId
  href: string
  label: string
  description: string
  icon: LucideIcon
  group: 'Umum' | 'Akun' | 'Produksi' | 'Lainnya'
  /** Roles that may open the section; omitted means every admin role. */
  roles?: readonly ('owner' | 'admin')[]
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: 'ringkasan', href: '/admin', label: 'Ringkasan', icon: LayoutGrid, group: 'Umum', description: 'Semua pengaturan website di satu tempat.' },
  { id: 'akun', href: '/admin/akun', label: 'Akun pengguna', icon: Users, group: 'Akun', roles: ['owner'], description: 'Tambah akun, atur role, nonaktifkan, atau hapus akun.' },
  { id: 'mesin', href: '/admin/mesin', label: 'Mesin produksi', icon: Printer, group: 'Produksi', description: 'Mesin Fedar, DTF, dan Press. Dipilih saat order masuk Proses Sublim dan dipakai untuk kapasitas.' },
  { id: 'waktu-kerja', href: '/admin/waktu-kerja', label: 'Waktu kerja', icon: Clock3, group: 'Produksi', description: 'Shift, istirahat & setup, operator standar, dan kecepatan desain.' },
  { id: 'jam-operator', href: '/admin/jam-operator', label: 'Jam operator', icon: HardHat, group: 'Produksi', description: 'Ubah jumlah operator pada hari tertentu. Hari lain memakai operator standar.' },
  { id: 'link-stok', href: '/admin/link-stok', label: 'Link spreadsheet stok', icon: Sheet, group: 'Produksi', description: 'Dua tombol spreadsheet stok yang tampil di Board Produksi.' },
  { id: 'customer-service', href: '/admin/customer-service', label: 'WhatsApp CS', icon: MessageCircle, group: 'Lainnya', description: 'Nomor WhatsApp tim TI yang dihubungi pengguna.' },
  { id: 'profil', href: '/admin/profil', label: 'Akun saya', icon: UserRound, group: 'Lainnya', description: 'Ubah nama dan password akun yang sedang login.' },
]

export function canOpenSection(section: AdminSection, role: unknown) {
  const normalized = normalizeRole(role)
  if (!normalized || normalized === 'operator') return false
  return !section.roles || section.roles.includes(normalized)
}
