import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const supa = getAdminClient()
    const { count, error } = await supa
      .from('profiles')
      .select('*', { head: true, count: 'exact' })
    if (error) throw error
    return NextResponse.json({ ok: true, profiles_count: count ?? null })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || String(e) }, { status: 500 })
  }
}
