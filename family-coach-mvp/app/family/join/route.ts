import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '../../lib/supabaseAdmin'  // make sure this file exists (see step 2 below)

export const dynamic = 'force-dynamic'

/**
 * Safely extract the user's JWT from the Supabase auth cookie without extra packages.
 * Supabase stores a cookie named: sb-<project-ref>-auth-token
 * The value is a JSON string that includes currentSession.access_token
 */
function getAccessTokenFromCookie(): string | null {
  try {
    const all = cookies().getAll()
    const authCookie = all.find(c => c.name.endsWith('-auth-token') && c.name.startsWith('sb-'))
    if (!authCookie?.value) return null
    const parsed = JSON.parse(authCookie.value)
    // Supabase stores the token at parsed.currentSession.access_token
    const token = parsed?.currentSession?.access_token || parsed?.access_token
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

    // 1) Get the user from the auth cookie (no auth-helpers needed)
    const jwt = getAccessTokenFromCookie()
    if (!jwt) return NextResponse.json({ error: 'Not signed in (no Supabase auth cookie)' }, { status: 401 })

    const admin = createAdminClient()

    // Verify token → get user
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ error: 'Invalid session token' }, { status: 401 })
    }
    const userId = userData.user.id

    // 2) Lookup family by invite code (case-insensitive) with service role
    const { data: fam, error: famErr } = await admin
      .from('families')
      .select('id,name,invite_code')
      .ilike('invite_code', invite)
      .maybeSingle()

    if (famErr) return NextResponse.json({ error: `Lookup failed: ${famErr.message}` }, { status: 400 })
    if (!fam?.id) return NextResponse.json({ error: 'Invalid code' }, { status: 404 })

    // 3) Attach user to family
    const up = await admin.from('profiles').update({ family_id: fam.id }).eq('id', userId)
    if (up.error) return NextResponse.json({ error: `Link failed: ${up.error.message}` }, { status: 400 })

    // 4) Ensure membership (ignore duplicate)
    const ins = await admin.from('family_members').insert({
      family_id: fam.id,
      user_id: userId,
      role: 'member',
      can_manage_members: false
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
