import { NextResponse } from 'next/server'
import { createAdmin } from '../../../lib/supabaseAdmin'
import { createClient } from '../../../lib/supabaseClient'

export async function POST(req: Request){
  const { email, family_id } = await req.json()
  if (!email || !family_id) return NextResponse.json({ error: 'email and family_id required' }, { status: 400 })
  const supa = createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 })
  const { data: fm } = await supa.from('family_members').select('role,can_manage_members').eq('family_id', family_id).eq('user_id', user.id).maybeSingle()
  if (!fm || (fm.role!=='owner' && !fm.can_manage_members)) return NextResponse.json({ error: 'not allowed' }, { status: 403 })
  const admin = createAdmin()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(String(email).toLowerCase(), {
    data: { family_id },
    redirectTo: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/onboarding?email=${encodeURIComponent(email)}&code=${family_id}` : undefined
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data?.user?.id || null })
}
