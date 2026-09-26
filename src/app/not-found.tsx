import Link from 'next/link'

export default function NotFound() {
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1><p>Alamat mungkin sudah berubah atau tidak tersedia.</p><Link href="/dashboard" className="text-brand-600 underline">Kembali ke Dashboard</Link></main>
}
