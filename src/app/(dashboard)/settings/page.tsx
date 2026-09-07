import { Users, Cog, Database, Shield } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Pengaturan</h2>
        <p className="text-sm text-slate-400 mt-0.5">Konfigurasi sistem Printex Order Monitoring</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Manajemen User</h3>
          </div>
          <p className="text-xs text-slate-500">Tambah, ubah, dan nonaktifkan akun staf. Kelola role dan permission setiap user.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <Cog className="h-5 w-5 text-violet-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Mesin Produksi</h3>
          </div>
          <p className="text-xs text-slate-500">Konfigurasi mesin, kecepatan produksi, dan waktu setup untuk jadwal otomatis.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Database className="h-5 w-5 text-emerald-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Import Data CSV</h3>
          </div>
          <p className="text-xs text-slate-500">Upload dan import data order dari file CSV. Mendukung mapping kolom dan deteksi duplikat.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
              <Shield className="h-5 w-5 text-amber-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Produksi Steps</h3>
          </div>
          <p className="text-xs text-slate-500">Konfigurasi tahapan produksi. Tambahkan step baru seperti RIP, QC, Administrasi di masa depan.</p>
        </div>
      </div>

      {/* Current Production Steps */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Tahapan Produksi Aktif</h3>
        <div className="space-y-2">
          {[
            { seq: 1, code: 'ORDER_IN', name: 'Order Masuk', color: 'bg-slate-100 text-slate-700' },
            { seq: 2, code: 'DESIGN', name: 'Proses Design', color: 'bg-red-100 text-red-700' },
            { seq: 3, code: 'DESIGN_DONE', name: 'Design Done', color: 'bg-blue-100 text-blue-700' },
            { seq: 4, code: 'PRINTING', name: 'Proses Cetak', color: 'bg-amber-100 text-amber-700' },
            { seq: 5, code: 'DONE', name: 'Done', color: 'bg-emerald-100 text-emerald-700' },
            { seq: 6, code: 'ARCHIVE', name: 'Arsip', color: 'bg-slate-200 text-slate-700' },
          ].map(step => (
            <div key={step.code} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{step.seq}</span>
              <code className="text-xs font-mono text-slate-400 w-24">{step.code}</code>
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${step.color}`}>{step.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          💡 Database dirancang fleksibel untuk menambah step seperti RIP, Press, QC, Administrasi di masa depan.
        </p>
      </div>
    </div>
  )
}
