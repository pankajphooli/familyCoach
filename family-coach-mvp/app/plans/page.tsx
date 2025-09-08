'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
import dynamic from 'next/dynamic'
const ChatCoach = dynamic(() => import('../components/ChatCoach'), { ssr: false })


type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }

const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00',
  snack: '11:00–12:00',
  lunch: '13:00–14:00',
  snack_pm: '16:00–17:00',
  dinner: '19:00–20:00'
}

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
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

  function notify(kind:'error'|'success', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){
      (window as any).toast(kind, msg)
    } else {
      if(kind==='error') console.warn(msg); else console.log(msg)
    }
  }

  const todayStr = useMemo(()=> ymdLocal(new Date()), [])

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

  async function pickMealsFor(dayIndex:number, pattern:string|null){
    try{
      let names:string[] = []
      const tags = ['Breakfast','Lunch','Dinner']
      for(const tag of tags){
        let q:any = supabase.from('recipes').select('name').ilike('tags', `%${tag}%`).limit(1).range(dayIndex, dayIndex)
        if(pattern) q = q.eq('dietary_pattern', pattern)
        const { data } = await q
        if(data && data.length){ names.push(data[0].name); continue }
        names.push('')
      }
      if(names.some(n=>n)) return [
        { meal_type: 'breakfast', recipe_name: names[0] || 'Oat Bowl' },
        { meal_type: 'lunch',     recipe_name: names[1] || 'Grilled Chicken Salad' },
        { meal_type: 'dinner',    recipe_name: names[2] || 'Veg Stir Fry' },
      ]
    }catch(e){/* ignore */}

    const omni = [
      ['Oat Bowl','Chicken Wrap','Salmon & Greens'],
      ['Greek Yogurt Parfait','Turkey Salad','Pasta Primavera'],
      ['Egg Scramble','Quinoa Bowl','Stir Fry Veg + Tofu'],
      ['Smoothie Bowl','Grilled Chicken Salad','Beef & Veg Skillet'],
      ['Avocado Toast','Tuna Sandwich','Curry & Rice'],
      ['Pancakes (light)','Sushi Bowl','Veggie Chili'],
      ['Muesli & Milk','Chicken Rice Bowl','Baked Fish & Veg']
    ]
    const veg = [
      ['Oat Bowl','Paneer Wrap','Chana Masala & Rice'],
      ['Greek Yogurt Parfait','Caprese Sandwich','Veg Biryani'],
      ['Tofu Scramble','Quinoa Bowl','Stir Fry Veg + Tofu'],
      ['Smoothie Bowl','Lentil Salad','Veggie Pasta'],
      ['Avocado Toast','Grilled Halloumi Salad','Thai Green Curry (veg)'],
      ['Pancakes (light)','Sushi Veg Bowl','Veggie Chili'],
      ['Muesli & Milk','Falafel Wrap','Baked Veg & Beans']
    ]
    const bank = (pattern && pattern.toLowerCase().includes('veg')) ? veg : omni
    const row = bank[dayIndex % bank.length]
    return [
      { meal_type: 'breakfast', recipe_name: row[0] },
      { meal_type: 'lunch',     recipe_name: row[1] },
      { meal_type: 'dinner',    recipe_name: row[2] },
    ]
  }

  // NEW: varied workouts for each weekday
  function pickWorkoutFor(dayIndex:number){
    const plans = [
      [
        { kind:'warmup',  title:'Light cardio',              details:'5–8 min brisk walk or cycle' },
        { kind:'circuit', title:'Full body circuit',         details:'3 rounds: 12 squats • 10 push-ups (knees ok) • 12 lunges/leg • 30s plank' },
        { kind:'cooldown',title:'Stretch',                   details:'5 min full-body stretch' },
      ],
      [
        { kind:'warmup',  title:'Band/arm warm-up',          details:'2×15 band pull-aparts + arm circles' },
        { kind:'circuit', title:'Upper + core',              details:'3 rounds: 12 rows (dumbbell/band) • 10 incline push-ups • 12 shoulder taps/side' },
        { kind:'cooldown',title:'Stretch',                   details:'Chest + shoulders + thoracic 5 min' },
      ],
      [
        { kind:'warmup',  title:'Easy cardio',               details:'5 min easy walk' },
        { kind:'circuit', title:'Steady cardio',             details:'25–30 min at RPE 6/10 (jog, cycle, brisk walk)' },
        { kind:'cooldown',title:'Core finisher',             details:'3×30s side planks + 3×10 bird-dogs/side' },
      ],
      [
        { kind:'warmup',  title:'Hips/ankles warm-up',       details:'Leg swings, ankle circles 2 min' },
        { kind:'circuit', title:'Lower body',                details:'3 rounds: 12 goblet squats • 12 RDLs • 12 step-ups/leg' },
        { kind:'cooldown',title:'Stretch',                   details:'Quads/hamstrings/hips 5 min' },
      ],
      [
        { kind:'warmup',  title:'Dynamic mobility',          details:'Cat-cow, world’s greatest stretch 3 min' },
        { kind:'circuit', title:'Mobility + core flow',      details:'3 rounds: 8 inchworms • 12 dead-bugs/side • 10 glute bridges' },
        { kind:'cooldown',title:'Breathing + stretch',       details:'Box breathing 2 min + stretch 3 min' },
      ],
      [
        { kind:'warmup',  title:'Jog/walk warm-up',          details:'5–8 min easy' },
        { kind:'circuit', title:'Intervals',                 details:'10×(1 min harder / 1 min easy) at RPE 7–8/10' },
        { kind:'cooldown',title:'Walk + stretch',            details:'5 min walk + calves/hips stretch' },
      ],
      [
        { kind:'warmup',  title:'Gentle limbering',          details:'Neck/shoulders/hips 2–3 min' },
        { kind:'circuit', title:'Active recovery',           details:'30–45 min easy walk or light bike' },
        { kind:'cooldown',title:'Relax + stretch',           details:'Light full-body stretch 5 min' },
      ],
    ]
    return plans[dayIndex % plans.length]
  }

  async function ensureMealsForDay(userId: string, pdId: string, dayIndex:number, pattern:string|null){
    const { data: existing } = await supabase.from('meals').select('id').eq('plan_day_id', pdId)
    if(existing && existing.length>0) return
    const defaults = await pickMealsFor(dayIndex, pattern)
    const insM = await supabase.from('meals').insert(defaults.map(m=>({ ...m, plan_day_id: pdId })))
    if(insM.error){ console.warn('meals insert error', insM.error); notify('error','Could not create meals (RLS).') }
  }

  async function ensureWorkoutForDay(userId: string, wdId: string, dayIndex:number){
    const { data: existing } = await supabase.from('workout_blocks').select('id').eq('workout_day_id', wdId)
    if(existing && existing.length>0) return
    const blocks = pickWorkoutFor(dayIndex)
    const insB = await supabase.from('workout_blocks').insert(blocks.map(b=>({ ...b, workout_day_id: wdId })))
    if(insB.error){ console.warn('workout_blocks insert error', insB.error); notify('error','Could not create workout blocks (RLS).') }
  }

  async function ensureWeekGenerated(userId: string, monday: Date){
    const prof = await supabase.from('profiles').select('dietary_pattern').eq('id', userId).maybeSingle(); const pattern = (prof.data as any)?.dietary_pattern || null;
    const days = rangeMonToSun(monday); for(let i=0;i<days.length;i++){ const d = days[i];
      const dateStr = ymdLocal(d)
      // Diet
      let { data: pd } = await supabase.from('plan_days').select('id').eq('user_id', userId).eq('date', dateStr).maybeSingle()
      if(!pd){
        const ins = await supabase.from('plan_days').insert({ user_id: userId, date: dateStr }).select('id').maybeSingle()
        if(ins.error){ console.warn('plan_days insert error', ins.error); notify('error','Diet auto-create blocked by permissions.'); continue }
        pd = { id: (ins.data as any).id }
      }
      await ensureMealsForDay(userId, (pd as any).id, i, pattern)

      // Workout
      let { data: wd } = await supabase.from('workout_days').select('id').eq('user_id', userId).eq('date', dateStr).maybeSingle()
      if(!wd){
        const insW = await supabase.from('workout_days').insert({ user_id: userId, date: dateStr }).select('id').maybeSingle()
        if(insW.error){ console.warn('workout_days insert error', insW.error); notify('error','Workout auto-create blocked by permissions.'); continue }
        wd = { id: (insW.data as any).id }
      }
      await ensureWorkoutForDay(userId, (wd as any).id, i)
    }
  }

  async function loadAll(userId: string){
    // Today diet
    const { data: todayPd } = await supabase.from('plan_days').select('id').eq('user_id', userId).eq('date', todayStr).maybeSingle()
    if(todayPd){
      const { data: mealsToday } = await supabase.from('meals').select('*').eq('plan_day_id', (todayPd as any).id).order('meal_type', { ascending: true })
      setTodayMeals(mealsToday || [])
    } else setTodayMeals([])

    // Week diet
    const mon = mondayOfWeek(new Date())
    const ymds = rangeMonToSun(mon).map(ymdLocal)
    const { data: pds } = await supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', ymds)
    const grouped: Record<string, Meal[]> = {}
    if(pds?.length){
      for(const pd of pds){
        const { data: ms } = await supabase.from('meals').select('*').eq('plan_day_id', (pd as any).id)
        grouped[(pd as any).date] = ms || []
      }
    }
    setWeekMeals(grouped)
    if((todayMeals?.length||0)===0){
      const t = grouped[todayStr]
      if(t && t.length) setTodayMeals(t)
    }

    // Today workout
    const { data: todayWd } = await supabase.from('workout_days').select('id').eq('user_id', userId).eq('date', todayStr).maybeSingle()
    if(todayWd){
      const { data: blocks } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', (todayWd as any).id)
      setTodayBlocks(blocks || [])
    } else setTodayBlocks([])

    // Week workout
    const { data: wds } = await supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', ymds)
    const groupedW: Record<string, WorkoutBlock[]> = {}
    if(wds?.length){
      for(const wd of wds){
        const { data: bs } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', (wd as any).id)
        groupedW[(wd as any).date] = bs || []
      }
    }
    setWeekBlocks(groupedW)
    if((todayBlocks?.length||0)===0){
      const t = groupedW[todayStr]
      if(t && t.length) setTodayBlocks(t)
    }
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
    if(!user){ notify('error','Sign in first'); return }
    if(items.length===0){ notify('error','No structured ingredients found for this recipe'); return }
    const rows = items.map(name => ({ user_id: user.id, name, done: false }))
    let ins = await supabase.from('grocery_items').insert(rows)
    if(ins.error){
      const ins2 = await supabase.from('shopping_items').insert(rows)
      if(ins2.error){ notify('error','Could not add items to grocery list.'); return }
    }
    notify('success','Added to grocery list.')
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

      {/* Diet section */}
      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Diet plan</h2>
          <div className="flex items-center gap-2">
            <button className={'button'} onClick={()=>setDietView('today')} style={dietView==='today'?undefined:{opacity:.7}}>Today</button>
            <button className={'button'} onClick={()=>setDietView('week')}  style={dietView==='week'?undefined:{opacity:.7}}>Week</button>
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
              <div key={date} className="card" style={{display:'grid', gap:10}}>
                <div className="font-medium">{date}</div>
                <ul className="grid gap-2">
                  {meals.map(m => (
                    <li key={m.id} className="flex items-center justify-between">
                      <div>• {m.meal_type || 'Meal'} — <span className="opacity-70">{timeFor(m.meal_type)}</span> · <span>{m.recipe_name || 'TBD'}</span></div>
                      <div className="flex gap-2">
                        <a className="link" href={recipeLink(m.recipe_name)} target="_blank" rel="noreferrer">Recipe ↗</a>
                        <button className="button-outline" onClick={()=>openIngredients(m)}>Add to grocery</button>
                        <button className="button-outline" onClick={()=>loadReplacements(m)}>Replace</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Workout section */}
      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Exercise plan</h2>
          <div className="flex items-center gap-2">
            <button className={'button'} onClick={()=>setWorkoutView('today')} style={workoutView==='today'?undefined:{opacity:.7}}>Today</button>
            <button className={'button'} onClick={()=>setWorkoutView('week')}  style={workoutView==='week'?undefined:{opacity:.7}}>Week</button>
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
                    <div key={b.id} className="flex items-center justify-between">
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

      {/* Ingredients modal */}
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

      {/* Replacement modal */}
      {replacingId && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Replace meal</h3>
              <button className="icon-button" onClick={()=>{ setReplacingId(null); setAltOptions([]) }}>✕</button>
            </div>
            <div className="grid gap-2 my-3">
              {altOptions.length ? altOptions.map(name => (
                <button key={name} className="button-outline" onClick={()=>{
                  const mealId = replacingId!; replaceMeal({id:mealId, plan_day_id:'', meal_type:'', recipe_name:''} as Meal, name)
                }}>{name}</button>
              )) : <div className="muted">No alternatives found.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Exercise detail modal */}
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
      <ChatCoach />
    </div>
  )
}
