import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type CalEvent = { id:string; title:string; date:string; start_time?:string|null; end_time?:string|null }
type Meal = { id:string; plan_day_id:string; meal_type:string; recipe_name:string|null }
type WorkoutBlock = { id:string; workout_day_id:string; kind?:string|null; title?:string|null; details?:string|null }

const pad = (n:number)=>String(n).padStart(2,'0')
const ymd = (d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
function mondayOfWeek(d: Date){
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = c.getDay() || 7
  if(day>1) c.setDate(c.getDate()-(day-1))
  return c
}
function weekDatesFrom(d: Date){
  const m = mondayOfWeek(d); const out: string[]=[]
  for(let i=0;i<7;i++){ const dd = new Date(m); dd.setDate(m.getDate()+i); out.push(ymd(dd)) }
  return out
}
async function tableExists(name: string, client: ReturnType<typeof getAdminClient>) {
  try {
    const r = await client.from(name).select('id').limit(1)
    // If it's not a "relation does not exist" error, we consider it present (RLS etc.)
    // PostgREST uses code '42P01' for missing table
    return !(r as any).error || (r as any).error?.code !== '42P01'
  } catch { return false }
}

export async function GET(req: Request) {
  try {
    const admin = getAdminClient()

    // Auth: accept the client access token and verify it to get the user id
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 })

    const userRes = await admin.auth.getUser(token)
    const uid = userRes.data.user?.id
    if (!uid) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const today = ymd(new Date())
    const week = weekDatesFrom(new Date())

    // Profile (support both goal_* and target_*)
    const profSel = 'full_name, goal_weight, target_weight, goal_date, target_date'
    const prof = await admin.from('profiles').select(profSel).eq('id', uid).maybeSingle()

    // Latest weight
    const w = await admin.from('weights').select('kg').eq('user_id', uid).order('date', { ascending: false }).limit(1).maybeSingle()

    // Events (pick first table that exists)
    const evTables = ['events','calendar_events','family_events','household_events']
    let eventsByDate: Record<string, CalEvent[]> = {}
    for (const t of evTables) {
      if (!(await tableExists(t, admin))) continue
      const r = await admin.from(t)
        .select('id,title,name,date,start_time,end_time,starts_at,ends_at')
        .gte('date', today).lte('date', ymd(new Date(new Date().setDate(new Date().getDate()+14))))
      if (!r.error && r.data) {
        for (const row of r.data as any[]) {
          const d = row.date
          const ev: CalEvent = {
            id: String(row.id),
            title: row.title || row.name || 'Event',
            date: d,
            start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11,16) : null),
            end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11,16) : null)
          }
          ;(eventsByDate[d] ||= []).push(ev)
        }
        Object.values(eventsByDate).forEach(arr => arr.sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||'')))
        break
      }
    }

    // Diet for the week
    const pds = await admin.from('plan_days').select('id,date').eq('user_id', uid).in('date', week)
    const byMeals: Record<string, Meal[]> = {}; week.forEach(d => byMeals[d] = [])
    if (!pds.error && pds.data?.length) {
      const pdIds = pds.data.map((p: any)=>p.id)
      const meals = await admin.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds)
      if (!meals.error && meals.data) {
        for (const pd of pds.data) {
          byMeals[pd.date] = (meals.data as any[]).filter(m => m.plan_day_id === pd.id)
        }
      }
    }

    // Workouts for the week
    const wds = await admin.from('workout_days').select('id,date').eq('user_id', uid).in('date', week)
    const byBlocks: Record<string, WorkoutBlock[]> = {}; week.forEach(d => byBlocks[d] = [])
    if (!wds.error && wds.data?.length) {
      const wdIds = wds.data.map((w: any)=>w.id)
      const blocks = await admin.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds)
      if (!blocks.error && blocks.data) {
        for (const wd of wds.data) {
          byBlocks[wd.date] = (blocks.data as any[]).filter(b => b.workout_day_id === wd.id)
        }
      }
    }

    // Grocery (support both names)
    let grocery: any[] = []
    for (const g of ['grocery_items','shopping_items']) {
      if (!(await tableExists(g, admin))) continue
      const gr = await admin.from(g).select('id,name,quantity,unit,done').eq('user_id', uid).order('name')
      if (!gr.error && gr.data) { grocery = gr.data as any[]; break }
    }

    return NextResponse.json({
      profile: prof.data || null,
      latestWeight: (w.data as any)?.kg ?? null,
      eventsByDate,
      mealsByDate: byMeals,
      blocksByDate: byBlocks,
      grocery
    })
  } catch (e) {
    console.warn('home/summary error', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
