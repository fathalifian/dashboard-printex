'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { login } from './actions'

function LoginFields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <>
      <fieldset disabled={pending} aria-busy={pending} className="space-y-6">
        {children}
        <button
          type="submit"
          className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait disabled:opacity-70"
        >
          {pending && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {pending ? 'Memproses...' : 'Masuk'}
        </button>
      </fieldset>
      {pending && (
        <div className="fixed inset-0 z-50 flex cursor-wait items-center justify-center bg-slate-950/40 p-6 backdrop-blur-sm">
          <div role="status" aria-live="polite" aria-atomic="true" className="flex w-full max-w-sm flex-col items-center rounded-2xl bg-white px-8 py-9 text-center shadow-xl">
            <LoaderCircle aria-hidden="true" className="mb-5 h-12 w-12 animate-spin text-brand-600" />
            <p className="text-lg font-semibold text-slate-900">Sedang masuk...</p>
            <p className="mt-2 text-sm text-slate-600">Mohon tunggu, login sedang diproses.</p>
          </div>
        </div>
      )}
    </>
  )
}

export default function LoginForm({ children }: { children: ReactNode }) {
  return (
    <form action={login}>
      <LoginFields>{children}</LoginFields>
    </form>
  )
}
