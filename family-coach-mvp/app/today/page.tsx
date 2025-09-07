'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

export default function Today(){
  const supabase = createClient()
  const [today] = useState(new Date().toISOString().slice(0,10))
  const [planMeals, setPlanMeals] = useState<any[]>([])
  const [workoutBlocks, setWorkoutBlocks] = useState<any[]>([])

  const generateDiet = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    const pattern = (profile?.dietary_pattern || 'non-veg').toLowerCase()
    const res = await fetch('/data/meal_plan_week_v1.json')
    const plan = await res.json()
    const dayIdx = (new Date(today).getDay()+6)%7
    const slot = (pattern.includes('veg') && !pattern.includes('non-veg')) ? plan.veg[dayIdx] : plan.nonveg[dayIdx]

        // Estimate kcal target from Mifflin-St Jeor + activity + goal
    const ageYears = profile?.dob ? Math.max(18, Math.floor((Date.now() - new Date(profile.dob).getTime()) / (365.25*24*3600*1000))) : 30
    const w = Number(profile?.weight_kg) || 70
    const h = Number(profile?.height_cm) || 170
    const sex = (profile?.sex || 'male').toLowerCase()
    const bmr = sex === 'female' ? (10*w + 6.25*h - 5*ageYears - 161) : (10*w + 6.25*h - 5*ageYears + 5)
    const activityMap:any = {
      'sedentary (little/no exercise)': 1.2,
      'lightly active (1-3 days/week)': 1.375,
      'moderately active (3-5 days/week)': 1.55,
      'very active (6-7 days/week)': 1.725,
      'athlete (2x/day)': 1.9
    }
    const mult = activityMap[profile?.activity_level || 'sedentary (little/no exercise)'] || 1.2
    let total_kcal = Math.round(bmr * mult)
    const goal = (profile?.primary_goal || '').toLowerCase()
    if (goal.includes('fat')) total_kcal = Math.round(total_kcal * 0.85)
    if (goal.includes('muscle')) total_kcal = Math.round(total_kcal * 1.10)

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

  const generateWorkout = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()

    const duration = profile?.time_per_workout_min || 25
    const conditions = (profile?.conditions || []) as string[]
    const equipment = (profile?.equipment || []) as string[]

    const lowImpact = conditions?.some(c => String(c).toLowerCase().includes('knee') || String(c).toLowerCase().includes('back'))
    const hasDumbbells = equipment?.some(e => String(e).toLowerCase().includes('dumbbell'))
    const hasBands = equipment?.some(e => String(e).toLowerCase().includes('band'))
    const gym = equipment?.some(e => String(e).toLowerCase().includes('gym'))

    const goal = profile?.primary_goal || 'general fitness'

    // Create workout day
    const { data: wday, error: e1 } = await supabase.from('workout_days').insert({
      user_id: user.id, date: today, goal, duration_min: duration, intensity: lowImpact ? 'low' : 'moderate'
    }).select().single()
    if(e1){ alert(e1.message); return }

    // Build blocks
    const blocks:any[] = []

    blocks.push({
      workout_day_id: wday.id,
      type: 'warmup',
      movements: [{ name: 'Joint mobility flow', time_min: 5 }, { name: 'Glute bridges', reps: 12 }],
      sets: 1, reps: null, rpe: 3
    })

    if (lowImpact) {
      blocks.push({
        workout_day_id: wday.id,
        type: 'circuit (low-impact)',
        movements: [
          { name: 'Step-ups (low box)', reps: 10 },
          { name: 'Wall push-ups', reps: 12 },
          { name: 'Bird-dog', reps: 10 },
          { name: 'Dead bug', reps: 10 }
        ],
        sets: 3, reps: 10, rpe: 6
      })
    } else if (hasDumbbells || gym) {
      blocks.push({
        workout_day_id: wday.id,
        type: 'strength circuit',
        movements: [
          { name: 'DB Goblet Squat', reps: 10 },
          { name: 'DB Bench/Push-up', reps: 10 },
          { name: 'DB Row', reps: 12 },
          { name: 'DB Romanian Deadlift', reps: 10 }
        ],
        sets: 3, reps: 10, rpe: 7
      })
    } else if (hasBands) {
      blocks.push({
        workout_day_id: wday.id,
        type: 'bands circuit',
        movements: [
          { name: 'Band Squat', reps: 12 },
          { name: 'Band Row', reps: 12 },
          { name: 'Band Press', reps: 12 },
          { name: 'Band RDL', reps: 12 }
        ],
        sets: 3, reps: 12, rpe: 7
      })
    } else {
      blocks.push({
        workout_day_id: wday.id,
        type: 'bodyweight circuit',
        movements: [
          { name: 'Air Squat', reps: 12 },
          { name: 'Push-up (elevated if needed)', reps: 10 },
          { name: 'Hip Hinge', reps: 12 },
          { name: 'Reverse Lunge', reps: 8 }
        ],
        sets: 3, reps: 10, rpe: 7
      })
    }

    blocks.push({
      workout_day_id: wday.id,
      type: 'finisher',
      movements: [{ name: lowImpact ? 'Brisk Walk' : 'Speed Intervals (Bike/Run/Jump Rope)', time_min: 8 }],
      sets: 1, reps: null, rpe: 6
    })

    const { data: inserted, error: e2 } = await supabase.from('workout_blocks').insert(blocks).select()
    if(e2){ alert(e2.message); return }
    setWorkoutBlocks(inserted || [])
  }

  const loadDiet = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if(!day) return
    const { data: meals } = await supabase.from('plan_meals').select('*').eq('plan_day_id', day.id)
    setPlanMeals(meals||[])
  }

  const loadWorkout = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: wday } = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if(!wday) return
    const { data: blocks } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', wday.id)
    setWorkoutBlocks(blocks||[])
  }

  const addMealsToGrocery = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if(!day){ alert('No plan for today yet'); return }
    const { data: meals } = await supabase.from('plan_meals').select('*').eq('plan_day_id', day.id)
    if(!meals || meals.length===0){ alert('No meals to add'); return }

    const { data: profile } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if(!profile?.family_id){ alert('Join or create a family first'); return }

    for (const m of meals){
      const { data: rec } = await supabase.from('recipes').select('ingredients').ilike('name', m.recipe_name).maybeSingle()
      if (rec?.ingredients){
        const parts = rec.ingredients.split(',').map((s:string)=>s.trim()).filter(Boolean)
        for (const p of parts){
          await supabase.from('grocery_items').insert({ family_id: profile.family_id, name: p })
        }
      } else {
        await supabase.from('grocery_items').insert({ family_id: profile.family_id, name: m.recipe_name })
      }
    }
    alert('Added ingredients to grocery list.')
  }

  useEffect(()=>{ loadDiet(); loadWorkout() }, [])

  return (
    <div className="card">
      <h2>Today&apos;s Plan</h2>
      <div className="grid grid-2">
        <div className="card">
          <h3>Diet</h3>
          {planMeals.length === 0 && <button className="button" onClick={generateDiet}>Generate Diet Plan</button>}
          {planMeals.length > 0 && <button className="button" onClick={addMealsToGrocery}>Add today&apos;s ingredients to Grocery</button>}
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
        <div className="card">
          <h3>Exercise</h3>
          {workoutBlocks.length === 0 && <button className="button" onClick={generateWorkout}>Generate Workout Plan</button>}
          {workoutBlocks.length > 0 && (
            <div className="grid">
              {workoutBlocks.map(b => (
                <div key={b.id} className="card">
                  <b>{b.type}</b>
                  <div><small className="muted">Sets: {b.sets} {b.reps ? `• Reps: ${b.reps}` : ''} {b.rpe ? `• RPE: ${b.rpe}` : ''}</small></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
