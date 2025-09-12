import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createClient } from '../../../lib/supabaseClient'
import { createAdminClient } from '../../lib/supabaseAdmin' // see file below

export async function POST(req: Request) {
  try {
    const { code } = await req.json() as { code?: string }
    const invite = (code || '').trim().toLowerCase()
    if (!invite) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

    // get the current user (from cookie/session)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    // admin client bypasses RLS to look up the family by code
    const admin = createAdminClient()
    const { data: fam, error } = await admin
      .from('families')
      .select('id,name,invite_code')
      .ilike('invite_code', invite)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!fam?.id) return NextResponse.json({ error: 'Invalid code' }, { status: 404 })

    // attach user to the family
    const up = await admin.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })

    // insert membership (ignore duplicate)
    const ins = await admin.from('family_members').insert({
      family_id: fam.id, user_id: user.id, role: 'member', can_manage_members: false,
    })
    if (ins.error) {
      const msg = String(ins.error.message || '').toLowerCase()
      if (!msg.includes('duplicate')) {
        return NextResponse.json({ error: ins.error.message }, { status: 400 })
      }
    }

    return NextResponse.json({ ok: true, family: fam })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
