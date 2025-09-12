// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'

export async function middleware(req: NextRequest) {
  // let static files through
  const { pathname } = req.nextUrl
  const publicPrefixes = [
    '/auth', '/api', '/favicon.ico', '/robots.txt', '/sitemap.xml',
    '/_next', '/images', '/assets'
  ]
  if (publicPrefixes.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { user } } = await supabase.auth.getUser()

  // If not signed in, redirect to /auth and remember where they were heading
  if (!user) {
    const to = new URL('/auth', req.url)
    to.searchParams.set('redirect', pathname + req.nextUrl.search)
    return NextResponse.redirect(to)
  }

  // Already signed in but on /auth → bounce them to where they came from
  if (user && pathname === '/auth') {
    const to = req.nextUrl.searchParams.get('redirect') || '/'
    return NextResponse.redirect(new URL(to, req.url))
  }

  return res
}

// match everything except static files
export const config = {
  matcher: ['/((?!.*\\.(?:svg|png|jpg|jpeg|gif|ico|css|js|map)$).*)']
}
