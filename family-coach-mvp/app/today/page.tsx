
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

export default function Today(){
  const supabase = createClient()
  const [today] = useState(new Date().toISOString().slice(0,10))
  const [planMeals, setPlanMeals] = useState<any[]>([])

  const generatePlan = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    // get profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    const pattern = (profile?.dietary_pattern || 'omnivore').toLowerCase()
    const res = await fetch('/data/meal_plan_week_v1.json')
    const plan = await res.json()
    const dayIdx = (new Date(today).getDay()+6)%7
    const slot = (pattern === 'vegetarian' || pattern === 'vegan' || pattern === 'jain') ? plan.veg[dayIdx] : plan.nonveg[dayIdx]

    // store plan_day and meals
    const total_kcal = 1800
    const { data: day, error } = await supabase.from('plan_days').insert({ user_id: user.id, date: today, total_kcal }).select().single()
    if(error){ alert(error.message); return }
    const meals = [
      { meal_type:'breakfast', recipe_name: slot.breakfast, kcal: 400 },
      { meal_type:'lunch', recipe_name: slot.lunch, kcal: 500 },
      { meal_type:'snack', recipe_name: slot.snack, kcal: 300 },
      { meal_type:'dinner', recipe_name: slot.dinner, kcal: 600 },
    ]
    const { data: inserted, error: e2 } = await supabase.from('plan_meals').insert(meals.map(m=>({ ...m, plan_day_id: day.id }))).select()
    if(e2){ alert(e2.message); return }
    setPlanMeals(inserted || [])
  }

  const loadPlan = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if(!day) return
    const { data: meals } = await supabase.from('plan_meals').select('*').eq('plan_day_id', day.id)
    setPlanMeals(meals||[])
  }

  useEffect(()=>{ loadPlan() }, [])

  return (
    <div className="card">
      <h2>Today&apos;s Diet Plan</h2>
      {planMeals.length === 0 && <button className="button" onClick={generatePlan}>Generate Plan</button>}
      {planMeals.length > 0 && (
        <div className="grid">
          {planMeals.map(m => (
            <div key={m.id} className="card">
              <b>{m.meal_type}</b>
              <div>{m.recipe_name}</div>
              <small className="muted">{m.kcal} kcal</small>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
