import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseConfig } from './config'
import { canAccessPage } from '@/lib/access-control'

export async function updateSession(request: NextRequest) {
  const {url:projectUrl,key}=supabaseConfig()
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    projectUrl,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const publicPage = pathname === '/login' || pathname === '/auth' || pathname.startsWith('/auth/')
  function redirectTo(path: string, error?: string) {
    const url = request.nextUrl.clone()
    url.pathname = path
    url.search = error ? `?error=${error}` : ''
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie))
    return response
  }

  if (!publicPage) {
    if (!user) return redirectTo('/login')
    const { data: profile, error } = await supabase.from('profiles').select('role,is_active').eq('id', user.id).single()
    if (error || !profile?.is_active || !canAccessPage(profile.role, '/dashboard')) return redirectTo('/login', 'access')
    if (!canAccessPage(profile.role, pathname)) return redirectTo('/dashboard')
  }

  return supabaseResponse
}
