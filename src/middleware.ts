import { type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// DEV MODE: Auth bypass — semua halaman dapat diakses tanpa login
// Ganti dengan implementasi Supabase Auth setelah database siap
export function middleware(request: NextRequest) {
  // Redirect root ke dashboard
  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
