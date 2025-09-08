'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type PlanDay = { id: string; user_id: string; date: string }
type WorkoutDay = { id: string; user_id: string; date: string }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }

const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00',
  snack: '11:00–12:00',
  lunch: '13:00–14:00',
  snack_pm: '16:00–17:00',
  dinner: '19:00–20:00'
}

function ymd(d: Date){ return d.toISOString().slice(0,10) }
function mondayOfWeek(d: Date){
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = dd.getDay() || 7 // Mon=1..Sun=7
  if(day>1){ dd.setDate(dd.getDate()-(day-1)) }
  return dd
}
function rangeMonToSun(monday: Date){
  const arr: Date[] = []
  for(let i=0;i<7;i++){ const d = new Date(monday); d.setDate(monday.getDate()+i); arr.push(d) }
  return arr
}

export default function PlansPage(){
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [dietView, setDietView] = useState<'today'|'week'>('today')
  const [workoutView, setWorkoutView] = useState<'today'|'week'>('today')
  const [todayMeals, setTodayMeals] = useState<Meal[]>([])
  const [weekMeals, setWeekMeals] = useState<Record<string, Meal[]>>({})
  const [todayBlocks, setTodayBlocks] = useState<WorkoutBlock[]>([])
  const [weekBlocks, setWeekBlocks] = useState<Record<string, WorkoutBlock[]>>({})
  const [replacingId, setReplacingId] = useState<string|null>(null)
  const [altOptions, setAltOptions] = useState<string[]>([])
  const [ingredientsFor, setIngredientsFor] = useState<string>('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [detailFor, setDetailFor] = useState<string>('')
  const [exerciseDetail, setExerciseDetail] = useState<{description?: string|null, image_url?: string|null, sets?: any, reps?: any} | null>(null)

  const todayStr = useMemo(()=> ymd(new Date()), [])

  useEffect(()=>{ (async()=>{
    setBusy(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ return }
      const mon = mondayOfWeek(new Date())
      await ensureWeekGenerated(user.id, mon)
      await loadAll(user.id)
    } finally { setBusy(false) }
  })() }, [])

  async function ensureWeekGenerated(userId: string, monday: Date){
    for(const d of rangeMonToSun(monday)){
      const dateStr = ymd(d)
      // Diet
      let { data: pd } = await supabase.from('plan_days').select('id').eq('user_id', userId).eq('date', dateStr).maybeSingle()
      if(!pd){
        const ins = await supabase.from('plan_days').insert({ user_id: userId, date: dateStr }).select('id').maybeSingle()
        if(ins.error) { console.warn('plan_days insert', ins.error); continue }
        pd = { id: (ins.data as any).id }
        const defaults = [
          { meal_type: 'breakfast', recipe_name: 'Oat Bowl' },
          { meal_type: 'lunch', recipe_name: 'Grilled Chicken Salad' },
          { meal_type: 'dinner', recipe_name: 'Veg Stir Fry' },
        ]
        await supabase.from('meals').insert(defaults.map(m=>({ ...m, plan_day_id: (pd as any).id })))
      }
      // Workout
      let { data: wd } = await supabase.from('workout_days').select('id').eq('user_id', userId).eq('date', dateStr).maybeSingle()
      if(!wd){
        const insW = await supabase.from('workout_days').insert({ user_id: userId, date: dateStr }).select('id').maybeSingle()
        if(insW.error) { console.warn('workout_days insert', insW.error); continue }
        wd = { id: (insW.data as any).id }
        const blocks = [
          { kind: 'warmup', title: 'Light cardio', details: '5–10 min brisk walk' },
          { kind: 'circuit', title: 'Bodyweight circuit', details: '3x rounds: 10 squats, 10 push-ups (knees ok), 20s plank' },
          { kind: 'cooldown', title: 'Stretch', details: '5 min full-body stretch' },
        ]
        await supabase.from('workout_blocks').insert(blocks.map(b=>({ ...b, workout_day_id: (wd as any).id })))
      }
    }
  }

  async function loadAll(userId: string){
    const { data: todayPd } = await supabase.from('plan_days').select('id').eq('user_id', userId).eq('date', todayStr).maybeSingle()
    if(todayPd){
      const { data: mealsToday } = await supabase.from('meals').select('*').eq('plan_day_id', (todayPd as any).id).order('meal_type', { ascending: true })
      setTodayMeals(mealsToday || [])
    } else setTodayMeals([])

    const mon = mondayOfWeek(new Date())
    const ymds = rangeMonToSun(mon).map(ymd)
    const { data: pds } = await supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', ymds)
    const grouped: Record<string, Meal[]> = {}
    if(pds?.length){
      for(const pd of pds){
        const { data: ms } = await supabase.from('meals').select('*').eq('plan_day_id', (pd as any).id)
        grouped[(pd as any).date] = ms || []
      }
    }
    setWeekMeals(grouped)

    const { data: todayWd } = await supabase.from('workout_days').select('id').eq('user_id', userId).eq('date', todayStr).maybeSingle()
    if(todayWd){
      const { data: blocks } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', (todayWd as any).id)
      setTodayBlocks(blocks || [])
    } else setTodayBlocks([])

    const { data: wds } = await supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', ymds)
    const groupedW: Record<string, WorkoutBlock[]> = {}
    if(wds?.length){
      for(const wd of wds){
        const { data: bs } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', (wd as any).id)
        groupedW[(wd as any).date] = bs || []
      }
    }
    setWeekBlocks(groupedW)
  }

  function timeFor(meal_type?: string | null){
    if(!meal_type) return '—'
    return MEAL_TIME[meal_type] || (meal_type.toLowerCase().includes('break') ? MEAL_TIME.breakfast :
                                    meal_type.toLowerCase().includes('lunch') ? MEAL_TIME.lunch :
                                    meal_type.toLowerCase().includes('dinner') ? MEAL_TIME.dinner : '—')
  }

  async function openIngredients(meal: Meal){
    const recipe = meal.recipe_name || ''
    setIngredientsFor(recipe)
    setIngredients([])
    const { data: rec } = await supabase.from('recipes').select('*').ilike('name', recipe).maybeSingle()
    const list: string[] = (rec?.ingredients as any) || []
    setIngredients(list || [])
  }

  async function addIngredientsToGrocery(items: string[]){
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    if(items.length===0){ alert('No structured ingredients found for this recipe'); return }
    const rows = items.map(name => ({ user_id: user.id, name, done: false }))
    let ins = await supabase.from('grocery_items').insert(rows)
    if(ins.error){
      const ins2 = await supabase.from('shopping_items').insert(rows)
      if(ins2.error){ alert('Could not add items to grocery list.'); return }
    }
    alert('Added to grocery list.')
  }

  async function loadReplacements(meal: Meal){
    setReplacingId(meal.id)
    setAltOptions([])
    const { data: { user } } = await supabase.auth.getUser()
    let pattern: string | null = null
    if(user){
      const prof = await supabase.from('profiles').select('dietary_pattern').eq('id', user.id).maybeSingle()
      pattern = (prof.data as any)?.dietary_pattern || null
    }
    let q: any = supabase.from('recipes').select('name')
    if(pattern){ q = q.eq('dietary_pattern', pattern) }
    const { data: opts } = await q.limit(15)
    setAltOptions((opts||[]).map((r:any)=>r.name))
  }

  async function replaceMeal(meal: Meal, name: string){
    await supabase.from('meals').update({ recipe_name: name }).eq('id', meal.id)
    setReplacingId(null)
    const { data: { user } } = await supabase.auth.getUser()
    if(user) await loadAll(user.id)
  }

  function recipeLink(name?: string | null){
    if(!name) return '#'
    const q = encodeURIComponent(`${name} recipe`)
    return `https://www.google.com/search?q=${q}`
  }

  async function openExerciseDetail(title?: string | null){
    setDetailFor(title || 'Exercise')
    setExerciseDetail(null)
    if(!title){ setExerciseDetail({}); return }
    const { data: ex } = await supabase.from('exercises').select('*').ilike('name', title).maybeSingle()
    if(ex){
      setExerciseDetail({ description: (ex as any).description, image_url: (ex as any).image_url, sets: (ex as any).sets, reps: (ex as any).reps })
      return
    }
    setExerciseDetail({})
  }

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Plans</h1>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Diet plan</h2>
          <div className="flex items-center gap-2">
            <button className={dietView==='today'?'button':'button-outline'} onClick={()=>setDietView('today')}>Today</button>
            <button className={dietView==='week'?'button':'button-outline'} onClick={()=>setDietView('week')}>Week</button>
          </div>
        </div>

        {dietView==='today' ? (
          <div className="grid gap-3">
            {todayMeals.length===0 && <div className="muted">No meals for today yet.</div>}
            {todayMeals.map(m=>(
              <div key={m.id} className="card row" style={{display:'grid', gap:8}}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{m.meal_type || 'Meal'} — <span className="opacity-70">{timeFor(m.meal_type)}</span></div>
                  <a className="link" href={recipeLink(m.recipe_name)} target="_blank" rel="noreferrer">Recipe ↗</a>
                </div>
                <div>{m.recipe_name || 'TBD'}</div>
                <div className="flex gap-2">
                  <button className="button-outline" onClick={()=>openIngredients(m)}>Add to grocery</button>
                  <button className="button-outline" onClick={()=>loadReplacements(m)}>Replace</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {Object.keys(weekMeals).length===0 && <div className="muted">No meals for this week yet.</div>}
            {Object.entries(weekMeals).sort().map(([date, meals]) => (
              <div key={date} className="card" style={{display:'grid', gap:8}}>
                <div className="font-medium">{date}</div>
                <div className="grid gap-2">
                  {meals.map(m => (
                    <div key={m.id} className="row flex items-center justify-between">
                      <div>{m.meal_type || 'Meal'} — <span className="opacity-70">{timeFor(m.meal_type)}</span> · <span>{m.recipe_name || 'TBD'}</span></div>
                      <div className="flex gap-2">
                        <a className="link" href={recipeLink(m.recipe_name)} target="_blank" rel="noreferrer">Recipe ↗</a>
                        <button className="button-outline" onClick={()=>openIngredients(m)}>Add to grocery</button>
                        <button className="button-outline" onClick={()=>loadReplacements(m)}>Replace</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Exercise plan</h2>
          <div className="flex items-center gap-2">
            <button className={workoutView==='today'?'button':'button-outline'} onClick={()=>setWorkoutView('today')}>Today</button>
            <button className={workoutView==='week'?'button':'button-outline'} onClick={()=>setWorkoutView('week')}>Week</button>
          </div>
        </div>

        {workoutView==='today' ? (
          <div className="grid gap-3">
            {todayBlocks.length===0 && <div className="muted">No workout for today yet.</div>}
            {todayBlocks.map(b => (
              <div key={b.id} className="card row" style={{display:'grid', gap:8}}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{b.title || b.kind || 'Block'}</div>
                  <button className="button-outline" onClick={()=>openExerciseDetail(b.title || b.kind || 'Exercise')}>Details</button>
                </div>
                <div className="opacity-80">{b.details || '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {Object.keys(weekBlocks).length===0 && <div className="muted">No workouts for this week yet.</div>}
            {Object.entries(weekBlocks).sort().map(([date, blocks]) => (
              <div key={date} className="card" style={{display:'grid', gap:8}}>
                <div className="font-medium">{date}</div>
                <div className="grid gap-2">
                  {blocks.map(b => (
                    <div key={b.id} className="row flex items-center justify-between">
                      <div>{b.title || b.kind || 'Block'} — <span className="opacity-70">{b.details || ''}</span></div>
                      <button className="button-outline" onClick={()=>openExerciseDetail(b.title || b.kind || 'Exercise')}>Details</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {ingredientsFor && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Ingredients — {ingredientsFor}</h3>
              <button className="icon-button" onClick={()=>{ setIngredientsFor(''); setIngredients([]) }}>✕</button>
            </div>
            <div className="grid gap-2 my-3">
              {ingredients.length ? ingredients.map((it,i)=>(<div key={i}>• {it}</div>)) : <div className="muted">No structured ingredients found.</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button className="button-outline" onClick={()=>{ setIngredientsFor(''); setIngredients([]) }}>Close</button>
              <button className="button" onClick={()=>addIngredientsToGrocery(ingredients)}>Add to grocery</button>
            </div>
          </div>
        </div>
      )}

      {replacingId && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Replace meal</h3>
              <button className="icon-button" onClick={()=>{ setReplacingId(null); setAltOptions([]) }}>✕</button>
            </div>
            <div className="grid gap-2 my-3">
              {altOptions.length ? altOptions.map(name => (
                <button key={name} className="row button-outline" onClick={()=>{
                  const mealId = replacingId!; replaceMeal({id:mealId, plan_day_id:'', meal_type:'', recipe_name:''} as Meal, name)
                }}>{name}</button>
              )) : <div className="muted">No alternatives found.</div>}
            </div>
          </div>
        </div>
      )}

      {detailFor && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{detailFor}</h3>
              <button className="icon-button" onClick={()=>{ setDetailFor(''); setExerciseDetail(null) }}>✕</button>
            </div>
            <div className="grid gap-2 my-3">
              {exerciseDetail?.description && <div>{exerciseDetail.description}</div>}
              {exerciseDetail?.sets && exerciseDetail?.reps && (<div>Sets × Reps: {String(exerciseDetail.sets)} × {String(exerciseDetail.reps)}</div>)}
              {exerciseDetail?.image_url && (<img src={exerciseDetail.image_url} alt={detailFor} style={{maxWidth:'100%', borderRadius:8}} />)}
              {!exerciseDetail && <div className="muted">Loading…</div>}
              {exerciseDetail && !exerciseDetail.description && !exerciseDetail.image_url && <div className="muted">No extra details available.</div>}
            </div>
          </div>
        </div>
      )}

      {busy && <div className="muted">Refreshing…</div>}
    </div>
  )
}
