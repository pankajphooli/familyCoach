import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabaseClient'

export async function POST(req: Request){
  const supa = createClient()
  const { data: { user } } = await supa.auth.getUser()
  const body = await req.json().catch(()=>({}))
  const { message, stack, context, path, family_id } = body || {}
  await supa.from('app_errors').insert({
    user_id: user?.id || null,
    family_id: family_id || null,
    path: path || null,
    message: message || 'unknown',
    stack: stack || null,
    context: context || null
  })
  return NextResponse.json({ ok: true })
}
