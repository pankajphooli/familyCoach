import { NextResponse } from 'next/server'
import { createAdmin } from '@/app/lib/supabaseAdmin'

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function mondayOfWeekContaining(d: Date){ const dow=d.getDay()||7; const mon=new Date(d); mon.setDate(d.getDate()-(dow-1)); mon.setHours(0,0,0,0); return mon }
function datesMonToSun(mon: Date){ return Array.from({length:7},(_,i)=>{ const x=new Date(mon); x.setDate(mon.getDate()+i); return x }) }

export async function GET(req: Request) {
  try {
    const auth = (req.headers as any).get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null
    if (!token) return NextResponse.json({ error: 'No auth token' }, { status: 401 })

    const admin = createAdmin()
    const { data: { user }, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const today = ymdLocal(new Date())
    const mon = mondayOfWeekContaining(new Date())
    const weekDates = datesMonToSun(mon).map(ymdLocal)

    const dayQ = await admin.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    let todayMeals:any[] = []
    if (dayQ.data) {
      const msQ = await admin.from('plan_meals').select('id,plan_day_id,meal_type,recipe_name').eq('plan_day_id', (dayQ.data as any).id).order('meal_type')
      todayMeals = (msQ.data as any[]) || []
    }

    const daysQ = await admin.from('plan_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
    const mapDayId:Record<string,string> = {}; for (const d of (daysQ.data||[])) mapDayId[(d as any).date]=(d as any).id
    const ids = Object.values(mapDayId)
    let weekMeals = weekDates.map(dt=>({ date: dt, meals: [] as any[] }))
    if (ids.length){
      const allMealsQ = await admin.from('plan_meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', ids)
      const grouped:Record<string,any[]> = {}
      for (const m of (allMealsQ.data||[])) {
        const dt = Object.keys(mapDayId).find(d => mapDayId[d] === (m as any).plan_day_id) || 'unknown'
        ;(grouped[dt] ||= []).push(m as any)
      }
      weekMeals = weekDates.map(dt => ({ date: dt, meals: grouped[dt] || [] }))
    }

    const wdayQ = await admin.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    let todayBlocks:any[] = []
    if (wdayQ.data){
      const blocksQ = await admin.from('workout_blocks').select('id,workout_day_id,type,movements').eq('workout_day_id', (wdayQ.data as any).id)
      todayBlocks = (blocksQ.data as any[]) || []
    }

    const wdaysQ = await admin.from('workout_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
    const wMap:Record<string,string> = {}; for (const d of (wdaysQ.data||[])) wMap[(d as any).date]=(d as any).id
    const wIds = Object.values(wMap)
    let weekBlocks = weekDates.map(dt=>({ date: dt, blocks: [] as any[] }))
    if (wIds.length){
      const allBlocksQ = await admin.from('workout_blocks').select('id,workout_day_id,type,movements').in('workout_day_id', wIds)
      const grouped:Record<string,any[]> = {}
      for (const b of (allBlocksQ.data||[])) {
        const dt = Object.keys(wMap).find(d => wMap[d] === (b as any).workout_day_id) || 'unknown'
        ;(grouped[dt] ||= []).push(b as any)
      }
      weekBlocks = weekDates.map(dt => ({ date: dt, blocks: grouped[dt] || [] }))
    }

    return NextResponse.json({ todayMeals, weekMeals, todayBlocks, weekBlocks })
  } catch (e:any) {
    console.error('/api/plans/load error', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
