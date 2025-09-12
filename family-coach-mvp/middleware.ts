import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  // Let Next.js internals & static files pass
  const isPublicFile = /\.(.*)$/.test(pathname)
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/images') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/manifest.json' ||
    isPublicFile
  ) {
    return NextResponse.next()
  }

  // Always allow auth pages
  if (pathname.startsWith('/auth')) {
    return NextResponse.next()
  }

  // Supabase sets cookies like: sb-<project-ref>-auth-token
  const hasSupabaseSession = req.cookies.getAll().some(c =>
    /^sb-.*-auth-token$/.test(c.name)
  )

  // Pages that require auth
  const protectedPrefixes = ['/', '/home', '/plans', '/calendar', '/grocery', '/family', '/profile']
  const isProtected = protectedPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))

  // Not signed in → send to /auth with return path
  if (isProtected && !hasSupabaseSession) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth'
    url.search = search
      ? `?redirectTo=${encodeURIComponent(pathname + search)}`
      : `?redirectTo=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

// Apply to everything except Next internals & static
export const config = {
  matcher: ['/((?!_next|api|images|favicon.ico|robots.txt|manifest.json).*)'],
}
