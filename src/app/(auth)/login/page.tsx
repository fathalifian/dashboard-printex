import { login } from './actions'
import Image from 'next/image'


export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams
  return (
    <main className="login-shell">
        <div className="login-brand-banner">
          <Image src="/batiklogin.jpeg" alt="" fill sizes="100vw" loading="eager" className="login-brand-background" />
          <div className="login-brand flex items-center gap-4">
          <Image src="/printex-brand.jpeg" alt="Logo Printex" width={88} height={88} sizes="(max-width: 767px) 64px, 88px" loading="eager" className="workspace-brand-logo" />
          <span className="workspace-brand-copy">
            <span className="workspace-brand-name">PRINTEX</span>
            <span className="workspace-brand-subtitle">MONITORING SYSTEM</span>
          </span>
          </div>
        </div>
        <section className="login-intro" aria-label="Printex Monitoring System">
        <div className="login-welcome space-y-5">
          <h2>Selamat Datang di <span>Printex Monitoring System</span></h2>
          <p><em>Pantau proses produksi secara real-time, kelola status pekerjaan, dan pastikan setiap pesanan berjalan sesuai alur.</em></p>
          <p className="login-intro-footer">Printex Monitoring System</p>
        </div>
      </section>
      <section className="login-form-panel"><div className="space-y-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Masuk ke Printex</h1>
          <p className="mt-2 text-sm text-slate-600">
            Masukkan akun Anda untuk membuka workspace.
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
                className="relative block w-full rounded-xl border border-slate-300 py-2.5 px-3 text-slate-900 placeholder:text-slate-400 sm:text-sm sm:leading-6"
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
                className="relative block w-full rounded-xl border border-slate-300 py-2.5 px-3 text-slate-900 placeholder:text-slate-400 sm:text-sm sm:leading-6"
                placeholder="Masukkan kata sandi"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative flex w-full justify-center rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 transition-colors"
            >
              Masuk
            </button>
          </div>
        </form>
        <p className="border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-500">Hubungi admin jika Anda membutuhkan akses akun.</p>
      </div></section>
    </main>
  )
}
