import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ✅ never run middleware logic on API or static assets
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|svg|css|js|ico)$/)
  ) {
    return NextResponse.next()
  }

  // ...your existing logic for app pages only...
  return NextResponse.next()
}
