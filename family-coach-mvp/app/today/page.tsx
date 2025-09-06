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

  useEffect(()=>{ loadDiet(); loadWorkout() }, [])

  return (
    <div className="card">
      <h2>Today&apos;s Plan</h2>
      <div className="grid grid-2">
        <div className="card">
          <h3>Diet</h3>
          {planMeals.length === 0 && <button className="button" onClick={generateDiet}>Generate Diet Plan</button>}
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
