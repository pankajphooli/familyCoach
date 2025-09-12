// app/api/family/join/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '../../lib/supabaseAdmin'

export const runtime = 'nodejs'          // ensure Node runtime
export const dynamic = 'force-dynamic'
export const revalidate = 0

function getAccessTokenFromCookie(): string | null {
  try {
    const all = cookies().getAll()
    const auth = all.find(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))
    if (!auth?.value) return null

    // Value can be JSON or URL-encoded JSON depending on platform
    const raw = (() => {
      try { return JSON.parse(auth.value) } catch (_) { /* maybe encoded */ }
      try { return JSON.parse(decodeURIComponent(auth.value)) } catch (_) { return null }
    })()
    const token = raw?.currentSession?.access_token || raw?.access_token
    return typeof token === 'string' ? token : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string }
    const invite = (code || '').trim().toLowerCase()
    if (!invite) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

    const jwt = getAccessTokenFromCookie()
    if (!jwt) return NextResponse.json({ error: 'Not signed in (no Supabase auth cookie)' }, { status: 401 })

    const admin = createAdminClient()

    // Verify the session → get user id
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ error: 'Invalid/expired session' }, { status: 401 })
    }
    const userId = userData.user.id

    // Find family by invite code (case-insensitive)
    const { data: fam, error: famErr } = await admin
      .from('families')
      .select('id,name,invite_code')
      .ilike('invite_code', invite)
      .maybeSingle()

    if (famErr) return NextResponse.json({ error: `Lookup failed: ${famErr.message}` }, { status: 400 })
    if (!fam?.id) return NextResponse.json({ error: 'Invalid code' }, { status: 404 })

    // Attach user to this family
    const up = await admin.from('profiles').update({ family_id: fam.id }).eq('id', userId)
    if (up.error) return NextResponse.json({ error: `Link failed: ${up.error.message}` }, { status: 400 })

    // Insert membership (ignore duplicate)
    const ins = await admin.from('family_members').insert({
      family_id: fam.id, user_id: userId, role: 'member', can_manage_members: false
    })
    if (ins.error) {
      const msg = String(ins.error.message || '').toLowerCase()
      if (!msg.includes('duplicate')) {
        return NextResponse.json({ error: `Membership failed: ${ins.error.message}` }, { status: 400 })
      }
    }

    return NextResponse.json({ ok: true, family: fam })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
