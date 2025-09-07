import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createAdmin } from '@/app/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const scope = body?.scope as string | undefined
    if (!scope) return NextResponse.json({ error: 'Missing scope' }, { status: 400 })

    const cookieStore = cookies()
    const supaServer = createRouteHandlerClient({ cookies: () => cookieStore })
    const { data: { user } } = await supaServer.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const admin = createAdmin()

    function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
    function mondayOfWeekContaining(d: Date){ const dow=d.getDay()||7; const mon=new Date(d); mon.setDate(d.getDate()-(dow-1)); mon.setHours(0,0,0,0); return mon }
    function datesMonToSun(mon: Date){ return Array.from({length:7},(_,i)=>{ const x=new Date(mon); x.setDate(mon.getDate()+i); return x }) }

    const todayStr = ymdLocal(new Date())

    const kcalFromProfile = (p:any) => {
      const age=p?.dob?Math.max(18,Math.floor((Date.now()-new Date(p.dob).getTime())/(365.25*24*3600*1000))):30
      const w=Number(p?.weight_kg)||70, h=Number(p?.height_cm)||170
      const sex=String(p?.sex||'male').toLowerCase()
      const bmr=sex==='female'?(10*w+6.25*h-5*age-161):(10*w+6.25*h-5*age+5)
      const multMap:any={'sedentary (little/no exercise)':1.2,'lightly active (1-3 days/week)':1.375,'moderately active (3-5 days/week)':1.55,'very active (6-7 days/week)':1.725,'athlete (2x/day)':1.9}
      const mult=multMap[p?.activity_level || 'sedentary (little/no exercise)'] || 1.2
      let total=Math.round(bmr*mult)
      const goal=String(p?.primary_goal||'').toLowerCase()
      if (goal.includes('fat')) total=Math.round(total*0.85)
      if (goal.includes('muscle')) total=Math.round(total*1.10)
      return total
    }

    async function ensureDietForDate(date:string){
      const ex = await admin.from('plan_days').select('id').eq('user_id', user.id).eq('date', date).maybeSingle()
      if (ex.error) throw ex.error
      if (ex.data) return ex.data.id
      const prof=await admin.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (prof.error) throw prof.error
      const total_kcal=kcalFromProfile(prof.data)
      const ins=await admin.from('plan_days').insert({ user_id: user.id, date, total_kcal }).select().single()
      if (ins.error) throw ins.error
      const pattern=String((prof.data as any)?.dietary_pattern||'non-veg').toLowerCase()
      const isVeg=pattern.includes('veg') && !pattern.includes('non-veg')
      const meals=[
        {meal_type:'breakfast',recipe_name:isVeg?'Veg Oats Bowl':'Scrambled Eggs'},
        {meal_type:'lunch',    recipe_name:isVeg?'Paneer Bowl':'Grilled Chicken Bowl'},
        {meal_type:'snack',    recipe_name:'Greek Yogurt & Fruit'},
        {meal_type:'dinner',   recipe_name=isVeg?'Tofu Stir-fry':'Salmon & Veg'}
      ].map(m=>({ ...m, plan_day_id: ins.data.id }))
      const pm=await admin.from('plan_meals').insert(meals)
      if (pm.error) throw pm.error
      return ins.data.id
    }

    async function ensureWorkoutForDate(date:string){
      const ex = await admin.from('workout_days').select('id').eq('user_id', user.id).eq('date', date).maybeSingle()
      if (ex.error) throw ex.error
      if (ex.data) return ex.data.id
      const ins=await admin.from('workout_days').insert({ user_id: user.id, date }).select().single()
      if (ins.error) throw ins.error
      const blocks=[
        {type:'Warm-up',  movements:[{name:'Joint mobility flow'}]},
        {type:'Circuit',  movements:[{name:'Glute bridges'},{name:'Step-ups (low box)'},{name:'Wall push-ups'}]},
        {type:'Cool-down',movements:[{name:'Breathing & stretch'}]}
      ].map(b=>({ ...b, workout_day_id: ins.data.id }))
      const wb=await admin.from('workout_blocks').insert(blocks)
      if (wb.error) throw wb.error
      return ins.data.id
    }

    if (scope === 'diet-today') {
      await ensureDietForDate(todayStr)
    } else if (scope === 'diet-week') {
      const mon=mondayOfWeekContaining(new Date())
      for (const d of datesMonToSun(mon)) await ensureDietForDate(ymdLocal(d))
    } else if (scope === 'workout-today') {
      await ensureWorkoutForDate(todayStr)
    } else if (scope === 'workout-week') {
      const mon=mondayOfWeekContaining(new Date())
      for (const d of datesMonToSun(mon)) await ensureWorkoutForDate(ymdLocal(d))
    } else {
      return NextResponse.json({ error: 'Unknown scope' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e:any) {
    console.error('/api/plans/generate error', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
