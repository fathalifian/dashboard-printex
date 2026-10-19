'use client'

import { useEffect } from 'react'

export default function ErrorRecovery({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Keep customer details and exception messages out of application logs.
    console.error('Printex: halaman gagal dirender', { digest: error.digest ?? 'client-render' })
  }, [error])
  return <main className="mx-auto max-w-xl space-y-4 p-8" role="alert">
    <h1 className="text-xl font-semibold">Halaman belum dapat ditampilkan</h1>
    <p>Coba buka kembali halaman ini. Jika masalah berlanjut, hubungi pengelola.</p>
    <div className="flex flex-wrap gap-4">
      <button type="button" onClick={retry} className="rounded-lg bg-brand-600 px-4 py-2 text-white">Coba lagi</button>
      <a href="/dashboard" className="rounded-lg border px-4 py-2">Kembali ke Dashboard</a>
    </div>
    {error.digest && <p className="text-sm">Kode bantuan: {error.digest}</p>}
  </main>
}
