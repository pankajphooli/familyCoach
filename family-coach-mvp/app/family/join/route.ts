import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createAdminClient } from '../../../lib/supabaseAdmin'

// Force this to run on the server every time (no static caching)
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string }
    const invite = (code || '').trim().toLowerCase()
    if (!invite) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    // 1) Get the current signed-in user from Supabase cookies
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()

    if (userErr) {
      return NextResponse.json({ error: `Auth error: ${userErr.message}` }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Not signed in (no Supabase session cookie found)' }, { status: 401 })
    }

    // 2) Use service-role admin to bypass RLS for lookup + linking
    const admin = createAdminClient()

    // Find family by invite code (case-insensitive)
    const { data: fam, error: famErr } = await admin
      .from('families')
      .select('id,name,invite_code')
      .ilike('invite_code', invite)
      .maybeSingle()

    if (famErr) {
      return NextResponse.json({ error: `Lookup failed: ${famErr.message}` }, { status: 400 })
    }
    if (!fam?.id) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 404 })
    }

    // 3) Attach the user to the family
    const up = await admin.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
    if (up.error) {
      return NextResponse.json({ error: `Link failed: ${up.error.message}` }, { status: 400 })
    }

    // 4) Insert membership (ignore duplicate)
    const ins = await admin.from('family_members').insert({
      family_id: fam.id,
      user_id: user.id,
      role: 'member',
      can_manage_members: false,
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
