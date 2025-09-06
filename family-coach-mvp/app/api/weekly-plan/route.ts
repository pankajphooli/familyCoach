import { NextResponse } from 'next/server'
import { createAdmin } from '../../../lib/supabaseAdmin'

export async function GET(){
  try{
    const admin = createAdmin()
    const today = new Date()
    const day = (today.getDay() + 6) % 7 // Mon=0
    const nextMon = new Date(today); nextMon.setDate(today.getDate() + (7 - day)); nextMon.setHours(0,0,0,0)
    const days: string[] = []
    for (let i=0;i<7;i++){ const d = new Date(nextMon); d.setDate(nextMon.getDate()+i); days.push(d.toISOString().slice(0,10)) }

    const { data: profiles, error } = await admin.from('profiles').select('*')
    if (error) throw new Error(error.message)

    for (const p of (profiles||[])){
      for (const d of days){
        const { data: existing } = await admin.from('plan_days').select('id').eq('user_id', p.id).eq('date', d).maybeSingle()
        if (existing) continue
        const ageYears = p?.dob ? Math.max(18, Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25*24*3600*1000))) : 30
        const w = Number(p?.weight_kg) || 70
        const h = Number(p?.height_cm) || 170
        const sex = String(p?.sex || 'male').toLowerCase()
        const bmr = sex === 'female' ? (10*w + 6.25*h - 5*ageYears - 161) : (10*w + 6.25*h - 5*ageYears + 5)
        const multMap:any = { 'sedentary (little/no exercise)':1.2,'lightly active (1-3 days/week)':1.375,'moderately active (3-5 days/week)':1.55,'very active (6-7 days/week)':1.725,'athlete (2x/day)':1.9 }
        const mult = multMap[p?.activity_level || 'sedentary (little/no exercise)'] || 1.2
        let total_kcal = Math.round(bmr * mult)
        const goal = String(p?.primary_goal||'').toLowerCase()
        if (goal.includes('fat')) total_kcal = Math.round(total_kcal * 0.85)
        if (goal.includes('muscle')) total_kcal = Math.round(total_kcal * 1.10)
        const ins = await admin.from('plan_days').insert({ user_id: p.id, date: d, total_kcal }).select().single()
        if (ins.error) continue
        const dayId = ins.data.id
        const pattern = String(p?.dietary_pattern||'non-veg').toLowerCase()
        const meals = [
          { meal_type:'breakfast', recipe_name: pattern.includes('veg') && !pattern.includes('non-veg') ? 'Veg Oats Bowl' : 'Scrambled Eggs', kcal: 0 },
          { meal_type:'lunch', recipe_name: pattern.includes('veg') && !pattern.includes('non-veg') ? 'Paneer Bowl' : 'Grilled Chicken Bowl', kcal: 0 },
          { meal_type:'snack', recipe_name: 'Greek Yogurt & Fruit', kcal: 0 },
          { meal_type:'dinner', recipe_name: pattern.includes('veg') && !pattern.includes('non-veg') ? 'Tofu Stir-fry' : 'Salmon & Veg', kcal: 0 },
        ]
        await admin.from('plan_meals').insert(meals.map(m=>({ ...m, plan_day_id: dayId })))
      }
    }
    return NextResponse.json({ ok: true, days })
  }catch(e:any){
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
