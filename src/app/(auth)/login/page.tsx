import { login } from './actions'


export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams
  return (
    <main className="login-shell">
      <section className="login-intro" aria-label="Printex Workspace">
        <span className="brand-wordmark">printex<span>.</span></span>
        <div className="space-y-5"><h2>Produksi terpantau.<br />Kerja lebih terarah.</h2><p>Satu ruang kerja untuk mengelola order, memantau proses produksi, dan melihat laporan tim Anda.</p></div>
        <p className="login-intro-footer">Printex Workspace / Manajemen produksi</p>
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
