import { NextResponse } from 'next/server'
import { createAdmin } from '../../lib/supabaseAdmin'

// Generates the upcoming week (Mon..Sun) for all profiles:
// - Diet: plan_days + plan_meals
// - Workout: workout_days + workout_blocks
export async function GET(){
  try{
    const admin = createAdmin()
    const today = new Date()
    const dow = (today.getDay() + 6) % 7 // Monday=0
    const nextMon = new Date(today); nextMon.setDate(today.getDate() + (7 - dow)); nextMon.setHours(0,0,0,0)
    const days: string[] = []
    for (let i=0;i<7;i++){ const d = new Date(nextMon); d.setDate(nextMon.getDate()+i); days.push(d.toISOString().slice(0,10)) }

    const { data: profiles, error } = await admin.from('profiles').select('*')
    if (error) throw new Error(error.message)

    for (const p of (profiles||[])){
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
      const pattern = String(p?.dietary_pattern||'non-veg').toLowerCase()
      const isVeg = pattern.includes('veg') && !pattern.includes('non-veg')

      for (const d of days){
        // Diet
        const { data: existing } = await admin.from('plan_days').select('id').eq('user_id', p.id).eq('date', d).maybeSingle()
        let dayId: string
        if (!existing){
          const ins = await admin.from('plan_days').insert({ user_id: p.id, date: d, total_kcal }).select().single()
          if (ins.error) continue
          dayId = ins.data.id
          const meals = [
            { meal_type:'breakfast', recipe_name: isVeg ? 'Veg Oats Bowl' : 'Scrambled Eggs' },
            { meal_type:'lunch', recipe_name: isVeg ? 'Paneer Bowl' : 'Grilled Chicken Bowl' },
            { meal_type:'snack', recipe_name: 'Greek Yogurt & Fruit' },
            { meal_type:'dinner', recipe_name: isVeg ? 'Tofu Stir-fry' : 'Salmon & Veg' },
          ]
          await admin.from('plan_meals').insert(meals.map(m=>({ ...m, plan_day_id: dayId })))
        }

        // Workout
        const { data: wexist } = await admin.from('workout_days').select('id').eq('user_id', p.id).eq('date', d).maybeSingle()
        if (!wexist){
          const wins = await admin.from('workout_days').insert({ user_id: p.id, date: d }).select().single()
          if (!wins.error){
            const blocks = [
              { type:'Warm-up', movements:[{name:'Joint mobility flow'}] },
              { type:'Circuit', movements:[{name:'Glute bridges'},{name:'Step-ups (low box)'},{name:'Wall push-ups'}] },
              { type:'Cool-down', movements:[{name:'Joint mobility flow'}] }
            ]
            await admin.from('workout_blocks').insert(blocks.map(b=>({ ...b, workout_day_id: wins.data.id })))
          }
        }
      }
    }
    return NextResponse.json({ ok: true, days })
  }catch(e:any){
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
