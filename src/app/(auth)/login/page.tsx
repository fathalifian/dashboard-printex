import { login } from './actions'
import Image from 'next/image'

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--background)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm space-y-7 rounded-xl bg-white p-6 sm:p-8 border border-slate-200">
        <div>
          <Image src="/printex-logo.png" alt="Printex" width={40} height={40} priority className="mx-auto mb-5 rounded-lg" />
          <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">Masuk ke Printex</h1>
          <p className="mt-2 text-center text-sm text-slate-600">
            Order Monitoring System
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error === 'access' ? 'Akun belum aktif atau akses tidak tersedia. Hubungi Owner.' : 'Login gagal. Periksa email, password, dan koneksi lalu coba lagi.'}</p>}
        <form className="space-y-6" action={login}>
          <div className="gap-5 flex flex-col">
            <div>
              <label htmlFor="email-address" className="mb-2 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="relative block w-full rounded-xl border-0 py-2.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                placeholder="nama@perusahaan.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
                Kata sandi
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="relative block w-full rounded-xl border-0 py-2.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                placeholder="Masukkan kata sandi"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative flex w-full justify-center rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
            >
              Masuk
            </button>
          </div>
        </form>
        <p className="border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-500">Hubungi admin jika Anda membutuhkan akses akun.</p>
      </div>
    </main>
  )
}
