'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }

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

  const todayStr = useMemo(()=> ymdLocal(new Date()), [])
  const monday = useMemo(()=> mondayOfWeek(new Date()), [])
  const weekDates = useMemo(()=> rangeMonToSun(monday).map(ymdLocal), [monday])

  // === FAST START: boot from cache, then refresh in background
  useEffect(()=>{
    try{
      const key = `plans_cache_${ymdLocal(monday)}`
      const raw = localStorage.getItem(key)
      if(raw){
        const parsed = JSON.parse(raw)
        if(parsed?.weekMeals) setWeekMeals(parsed.weekMeals)
        if(parsed?.weekBlocks) setWeekBlocks(parsed.weekBlocks)
        if(parsed?.todayMeals) setTodayMeals(parsed.todayMeals)
        if(parsed?.todayBlocks) setTodayBlocks(parsed.todayBlocks)
      }
    }catch{}
  }, [monday])

  useEffect(()=>{ (async()=>{
    setBusy(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ return }

      await ensureWeekIfNeeded(user.id)

      // Load all data with minimal round-trips
      await loadAll(user.id)

      // Save cache
      try{
        const key = `plans_cache_${ymdLocal(monday)}`
        localStorage.setItem(key, JSON.stringify({ weekMeals, weekBlocks, todayMeals, todayBlocks }))
      }catch{}
    } finally { setBusy(false) }
  })() }, [])

  // === GENERATION (BULK + GUARDED) ============================
  function defaultsForMeals(dayIndex:number, pattern:string|null){
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

  function pickWorkoutFor(dayIndex:number){
    const plans = [
      [
        { kind:'warmup',  title:'Light cardio',              details:'5–8 min brisk walk or cycle' },
        { kind:'circuit', title:'Full body circuit',         details:'3 rounds: 12 squats • 10 push-ups • 12 lunges/leg • 30s plank' },
        { kind:'cooldown',title:'Stretch',                   details:'5 min full-body stretch' }
      ],
      [
        { kind:'warmup',  title:'Band/arm warm-up',          details:'2×15 band pull-aparts + arm circles' },
        { kind:'circuit', title:'Upper + core',              details:'3 rounds: 12 rows • 10 incline push-ups • 12 shoulder taps/side' },
        { kind:'cooldown',title:'Stretch',                   details:'Chest/shoulders/upper-back 5 min' }
      ],
      [
        { kind:'warmup',  title:'Easy cardio',               details:'5 min easy walk' },
        { kind:'circuit', title:'Steady cardio',             details:'25–30 min at RPE 6/10 (jog, cycle, brisk walk)' },
        { kind:'cooldown',title:'Core finisher',             details:'3×30s side planks + 3×10 bird-dogs/side' }
      ],
      [
        { kind:'warmup',  title:'Hips/ankles warm-up',       details:'Leg swings, ankle circles 2 min' },
        { kind:'circuit', title:'Lower body',                details:'3 rounds: 12 goblet squats • 12 RDLs • 12 step-ups/leg' },
        { kind:'cooldown',title:'Stretch',                   details:'Quads/hamstrings/hips 5 min' }
      ],
      [
        { kind:'warmup',  title:'Dynamic mobility',          details:'Cat-cow, world’s greatest stretch 3 min' },
        { kind:'circuit', title:'Mobility + core flow',      details:'3 rounds: 8 inchworms • 12 dead-bugs/side • 10 glute bridges' },
        { kind:'cooldown',title:'Breathing + stretch',       details:'Box breathing 2 min + stretch 3 min' }
      ],
      [
        { kind:'warmup',  title:'Jog/walk warm-up',          details:'5–8 min easy' },
        { kind:'circuit', title:'Intervals',                 details:'10×(1 min harder / 1 min easy) at RPE 7–8/10' },
        { kind:'cooldown',title:'Walk + stretch',            details:'5 min walk + calves/hips stretch' }
      ],
      [
        { kind:'warmup',  title:'Gentle limbering',          details:'Neck/shoulders/hips 2–3 min' },
        { kind:'circuit', title:'Active recovery',           details:'30–45 min easy walk or light bike' },
        { kind:'cooldown',title:'Relax + stretch',           details:'Light full-body stretch 5 min' }
      ]
    ]
    return plans[dayIndex % plans.length]
  }

  async function ensureWeekIfNeeded(userId: string){
    try{
      const flagKey = `plans_ensured_monday`
      const mondayStr = ymdLocal(monday)
      const flag = typeof window !== 'undefined' ? localStorage.getItem(flagKey) : null
      if(flag === mondayStr){
        return
      }
      // Fetch existing plan_days & workout_days in one go
      const [pds, wds] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const havePd = new Set((pds.data||[]).map((r:any)=>r.date))
      const haveWd = new Set((wds.data||[]).map((r:any)=>r.date))

      // Insert missing days in bulk
      const missingPd = weekDates.filter(d=>!havePd.has(d)).map(date=>({ user_id: userId, date }))
      const missingWd = weekDates.filter(d=>!haveWd.has(d)).map(date=>({ user_id: userId, date }))
      await Promise.all([
        missingPd.length ? supabase.from('plan_days').insert(missingPd) : Promise.resolve(),
        missingWd.length ? supabase.from('workout_days').insert(missingWd) : Promise.resolve(),
      ])

      // Refresh ids
      const [pds2, wds2] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const pdByDate: Record<string, string> = {}; (pds2.data||[]).forEach((r:any)=> pdByDate[r.date]=r.id)
      const wdByDate: Record<string, string> = {}; (wds2.data||[]).forEach((r:any)=> wdByDate[r.date]=r.id)

      // Fetch all meals/blocks once
      const [mealsAll, blocksAll] = await Promise.all([
        supabase.from('meals').select('id,plan_day_id').in('plan_day_id', Object.values(pdByDate)),
        supabase.from('workout_blocks').select('id,workout_day_id').in('workout_day_id', Object.values(wdByDate)),
      ])
      const pdWithMeals = new Set((mealsAll.data||[]).map((m:any)=>m.plan_day_id))
      const wdWithBlocks = new Set((blocksAll.data||[]).map((b:any)=>b.workout_day_id))

      // Insert missing meals/blocks in bulk
      const prof = await supabase.from('profiles').select('dietary_pattern').eq('id', userId).maybeSingle()
      const pattern = (prof.data as any)?.dietary_pattern || null

      const mealsToInsert:any[] = []
      const blocksToInsert:any[] = []
      weekDates.forEach((date, i)=>{
        const pdId = pdByDate[date]; const wdId = wdByDate[date]
        if(pdId && !pdWithMeals.has(pdId)){
          const defs = defaultsForMeals(i, pattern)
          defs.forEach(m => mealsToInsert.push({ ...m, plan_day_id: pdId }))
        }
        if(wdId && !wdWithBlocks.has(wdId)){
          const defsB = pickWorkoutFor(i)
          defsB.forEach(b => blocksToInsert.push({ ...b, workout_day_id: wdId }))
        }
      })
      await Promise.all([
        mealsToInsert.length ? supabase.from('meals').insert(mealsToInsert) : Promise.resolve(),
        blocksToInsert.length ? supabase.from('workout_blocks').insert(blocksToInsert) : Promise.resolve(),
      ])

      if (typeof window !== 'undefined') localStorage.setItem(flagKey, mondayStr)
    }catch(e){
      console.warn('ensureWeekIfNeeded error', e)
    }
  }

  // === LOAD (3 round-trips total) ============================
  async function loadAll(userId: string){
    const [pdRes, wdRes] = await Promise.all([
      supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
    ])
    const pds = (pdRes.data||[]) as PlanDay[]
    const wds = (wdRes.data||[]) as WorkoutDay[]
    const pdIds = pds.map(p=>p.id)
    const wdIds = wds.map(w=>w.id)

    const [mealsRes, blocksRes] = await Promise.all([
      pdIds.length ? supabase.from('meals').select('*').in('plan_day_id', pdIds) : Promise.resolve({ data: [] } as any),
      wdIds.length ? supabase.from('workout_blocks').select('*').in('workout_day_id', wdIds) : Promise.resolve({ data: [] } as any),
    ])

    const meals = (mealsRes as any).data as Meal[] || []
    const blocks = (blocksRes as any).data as WorkoutBlock[] || []

    const byDateMeals: Record<string, Meal[]> = {}; weekDates.forEach(d=> byDateMeals[d]=[])
    for(const pd of pds){ byDateMeals[pd.date] = meals.filter(m=>m.plan_day_id===pd.id) }
    const byDateBlocks: Record<string, WorkoutBlock[]> = {}; weekDates.forEach(d=> byDateBlocks[d]=[])
    for(const wd of wds){ byDateBlocks[wd.date] = blocks.filter(b=>b.workout_day_id===wd.id) }

    setWeekMeals(byDateMeals)
    setWeekBlocks(byDateBlocks)
    setTodayMeals(byDateMeals[todayStr] || [])
    setTodayBlocks(byDateBlocks[todayStr] || [])
  }

  function timeFor(meal_type?: string | null){
    if(!meal_type) return '—'
    const mt = meal_type.toLowerCase()
    return MEAL_TIME[meal_type] || (mt.includes('break') ? MEAL_TIME.breakfast :
                                    mt.includes('lunch') ? MEAL_TIME.lunch :
                                    mt.includes('dinner') ? MEAL_TIME.dinner : '—')
  }

  function recipeLink(name?: string | null){
    if(!name) return '#'
    const q = encodeURIComponent(`${name} recipe`)
    return `https://www.google.com/search?q=${q}`
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
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {busy && <div className="muted">Refreshing…</div>}

      <ChatCoach />
      
    </div>
  )
}
