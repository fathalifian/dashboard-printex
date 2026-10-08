import { LoaderCircle } from 'lucide-react'

export default function Loading() {
  return <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
    <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-brand-600" />
    Membuka halaman...
  </div>
}
