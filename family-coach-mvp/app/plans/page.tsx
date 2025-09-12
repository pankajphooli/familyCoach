'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import './plans-ui.css'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }

type Profile = {
  dietary_pattern?: string|null
  meat_policy?: string|null
  allergies?: string[]|null
  dislikes?: string[]|null
  cuisine_prefs?: string[]|null
  injuries?: string[]|null
  health_conditions?: string[]|null
  equipment?: string[]|null
}

type Recipe = {
  name: string
  dietary_pattern?: string|null
  allergens?: string[]|null
  tags?: string[]|null
  ingredients?: string[]|null
  cuisine?: string|null
}

type Exercise = {
  name: string
  tags?: string[]|null
  equipment?: string[]|null
  contraindications?: string[]|null
  description?: string|null
}

type MainTab = 'diet' | 'workout'
type SubTab = 'today' | 'week'

const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00',
  snack: '11:00–12:00',
  lunch: '13:00–14:00',
  snack_pm: '16:00–17:00',
  dinner: '19:00–20:00'
}

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function normalizeName(s:string){ return (s||'').trim().toLowerCase() }
function recipeLink(name?: string | null){ if(!name) return '#'; const q = encodeURIComponent(`${name} recipe`); return `https://www.google.com/search?q=${q}` }
function mealTagFor(meal: Meal){
  const t = (meal.meal_type||'').toLowerCase()
  if(t.includes('break')) return 'Breakfast'
  if(t.includes('lunch')) return 'Lunch'
  return 'Dinner'
}
function pickFrom<T>(arr:T[], index:number, fallback:T): T{ return arr.length ? (arr[index % arr.length] || arr[0]) : fallback }

function nextNDatesFromToday(n:number){
  const start = new Date()
  const arr:string[] = []
  for(let i=0;i<n;i++){ const d = new Date(start); d.setDate(start.getDate()+i); arr.push(ymdLocal(d)) }
  return arr
}

export default function PlansPage(){
  const supabase = useMemo(()=>{
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    return createSupabaseClient(url, anon)
  }, [])

  const [busy, setBusy] = useState(false)
  const [mainTab, setMainTab] = useState<MainTab>('diet')
  const [dietTab, setDietTab] = useState<SubTab>('today')
  const [workoutTab, setWorkoutTab] = useState<SubTab>('today')

  const [todayMeals, setTodayMeals] = useState<Meal[]>([])
  const [weekMeals, setWeekMeals] = useState<Record<string, Meal[]>>({})
  const [todayBlocks, setTodayBlocks] = useState<WorkoutBlock[]>([])
  const [weekBlocks, setWeekBlocks] = useState<Record<string, WorkoutBlock[]>>({})
  const [ingredientsFor, setIngredientsFor] = useState<string>('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [replacingId, setReplacingId] = useState<string|null>(null)
  const [altOptions, setAltOptions] = useState<string[]>([])
  const [profile, setProfile] = useState<Profile|null>(null)

  const todayStr = useMemo(()=> ymdLocal(new Date()), [])
  const weekDates = useMemo(()=> nextNDatesFromToday(7), [])
  const [selectedWeekDate, setSelectedWeekDate] = useState<string>(todayStr)
  const cacheKey = useRef<string>('')

  function notify(kind:'error'|'success', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){
      (window as any).toast(kind, msg)
    } else {
      if(kind==='error') console.warn(msg); else console.log(msg)
    }
  }

  useEffect(()=>{
    cacheKey.current = `plans_cache_${weekDates[0]}`
    try{
      const raw = localStorage.getItem(cacheKey.current)
      if(raw){
        const parsed = JSON.parse(raw)
        setWeekMeals(parsed.weekMeals||{})
        setWeekBlocks(parsed.weekBlocks||{})
        setTodayMeals(parsed.todayMeals||[])
        setTodayBlocks(parsed.todayBlocks||[])
      }
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(()=>{ (async()=>{
    setBusy(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ return }
      const profSel = 'dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
      const profRes = await supabase.from('profiles').select(profSel).eq('id', user.id).maybeSingle()
      setProfile((profRes.data || null) as Profile)

      await ensureWeekIfNeeded(user.id, (profRes.data || {}) as Profile)
      await loadAll(user.id)

      try{
        localStorage.setItem(cacheKey.current, JSON.stringify({ weekMeals, weekBlocks, todayMeals, todayBlocks }))
      }catch{}
    } finally { setBusy(false) }
  })() }, []) // load once

  function isRecipeAllowed(rec: Recipe, prof: Profile){
    const allergies = (prof.allergies||[]).map(normalizeName)
    const dislikes = (prof.dislikes||[]).map(normalizeName)
    const recAllergens: string[] = (rec.allergens || []).map((x:any)=>normalizeName(String(x)))
    if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false

    const nameLc = normalizeName(rec.name || '')
    if(dislikes.length && dislikes.some((d:string) => d && nameLc.includes(d))) return false

    const meatPolicy = normalizeName(prof.meat_policy||'')
    if(meatPolicy==='non_veg_chicken_only'){
      const banned = ['beef','pork','bacon','mutton','lamb','fish','salmon','tuna','prawn','shrimp','shellfish']
      if(banned.some(b => nameLc.includes(b))) return false
    }
    return true
  }

  function isExerciseAllowed(ex: Exercise, prof:Profile){
    const eqp = (prof.equipment||[]).map(normalizeName)
    const need: string[] = (ex.equipment||[]).map((x:any)=>normalizeName(String(x)))
    const contra: string[] = (ex.contraindications||[]).map((x:any)=>normalizeName(String(x)))
    const flags = [...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalizeName)
    if(need.length && need.some(n => n!=='none' && !eqp.includes(n))) return false
    if(flags.length && contra.some(c => flags.includes(c))) return false
    return true
  }

  async function candidatesFor(tag:string, prof:Profile, limit=50): Promise<Recipe[]>{
    let q:any = supabase.from('recipes').select('name, dietary_pattern, allergens, tags, ingredients, cuisine').limit(limit)
    q = q.ilike('tags', `%${tag}%`)
    const { data } = await q
    const list = (data as Recipe[]) || []
    return list.filter((rec: Recipe) => isRecipeAllowed(rec, prof))
  }

  async function defaultsForMeals(dayIndex:number, prof: Profile){
    try{
      const [b, l, d] = await Promise.all([
        candidatesFor('Breakfast', prof),
        candidatesFor('Lunch', prof),
        candidatesFor('Dinner', prof)
      ])
      const bName = pickFrom<Recipe>(b, dayIndex, {name:'Oat Bowl'} as Recipe).name
      const lName = pickFrom<Recipe>(l, dayIndex, {name:'Chicken Wrap'} as Recipe).name
      const dName = pickFrom<Recipe>(d, dayIndex, {name:'Veg Stir Fry'} as Recipe).name
      return [
        { meal_type: 'breakfast', recipe_name: bName },
        { meal_type: 'lunch',     recipe_name: lName },
        { meal_type: 'dinner',    recipe_name: dName },
      ]
    }catch{
      const bank = [
        ['Oat Bowl','Chicken Wrap','Salmon & Greens'],
        ['Greek Yogurt Parfait','Turkey Salad','Pasta Primavera'],
        ['Egg Scramble','Quinoa Bowl','Stir Fry Veg + Tofu'],
        ['Smoothie Bowl','Grilled Chicken Salad','Beef & Veg Skillet'],
        ['Avocado Toast','Tuna Sandwich','Curry & Rice'],
        ['Pancakes (light)','Sushi Bowl','Veggie Chili'],
        ['Muesli & Milk','Chicken Rice Bowl','Baked Fish & Veg']
      ]
      const row = bank[dayIndex % bank.length]
      return [
        { meal_type: 'breakfast', recipe_name: row[0] },
        { meal_type: 'lunch',     recipe_name: row[1] },
        { meal_type: 'dinner',    recipe_name: row[2] },
      ]
    }
  }

  async function pickWorkoutFor(dayIndex:number, prof:Profile){
    const { data } = await supabase.from('exercises').select('name,tags,equipment,contraindications,description').limit(120)
    const exs = (data as Exercise[]) || []
    const allowed = exs.filter((ex:Exercise) => isExerciseAllowed(ex, prof))
    const a = pickFrom<Exercise>(allowed, dayIndex,   {name:'Glute bridge', description:'3×12'} as Exercise)
    const b = pickFrom<Exercise>(allowed, dayIndex+3, {name:'Row (band)',   description:'3×12'} as Exercise)
    const c = pickFrom<Exercise>(allowed, dayIndex+5, {name:'Plank',        description:'3×30s'} as Exercise)
    return [
      { kind:'warmup',  title:'Warm-up',    details:'5–8 min easy walk + mobility' },
      { kind:'circuit', title: a.name,      details: a.description || '3×12' },
      { kind:'circuit', title: b.name,      details: b.description || '3×12' },
      { kind:'circuit', title: c.name,      details: c.description || '3×12' },
      { kind:'cooldown',title:'Cooldown',   details:'Stretch 5 min' }
    ]
  }

  async function ensureWeekIfNeeded(userId: string, prof: Profile){
    try{
      const flagKey = `plans_ensured_${weekDates[0]}`
      const flag = typeof window !== 'undefined' ? localStorage.getItem(flagKey) : null
      if(flag === '1'){ return }

      const [pds, wds] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const havePd = new Set(((pds.data||[]) as PlanDay[]).map((r)=>r.date))
      const haveWd = new Set(((wds.data||[]) as WorkoutDay[]).map((r)=>r.date))

      const missingPd = weekDates.filter(d=>!havePd.has(d)).map(date=>({ user_id: userId, date }))
      const missingWd = weekDates.filter(d=>!haveWd.has(d)).map(date=>({ user_id: userId, date }))
      if(missingPd.length) await supabase.from('plan_days').insert(missingPd)
      if(missingWd.length) await supabase.from('workout_days').insert(missingWd)

      const [pds2, wds2] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const pdByDate: Record<string, string> = {}; ((pds2.data||[]) as PlanDay[]).forEach((r)=> pdByDate[r.date]=r.id)
      const wdByDate: Record<string, string> = {}; ((wds2.data||[]) as WorkoutDay[]).forEach((r)=> wdByDate[r.date]=r.id)

      const [mealsAll, blocksAll] = await Promise.all([
        supabase.from('meals').select('id,plan_day_id').in('plan_day_id', Object.values(pdByDate)),
        supabase.from('workout_blocks').select('id,workout_day_id').in('workout_day_id', Object.values(wdByDate)),
      ])
      const pdWithMeals = new Set(((mealsAll.data||[]) as {id:string;plan_day_id:string}[]).map((m)=>m.plan_day_id))
      const wdWithBlocks = new Set(((blocksAll.data||[]) as {id:string;workout_day_id:string}[]).map((b)=>b.workout_day_id))

      const mealsToInsert:any[] = []
      const blocksToInsert:any[] = []
      for(let i=0;i<weekDates.length;i++){
        const date = weekDates[i]
        const pdId = pdByDate[date]; const wdId = wdByDate[date]
        if(pdId && !pdWithMeals.has(pdId)){
          const defs = await defaultsForMeals(i, (prof||{}) as Profile)
          defs.forEach(m => mealsToInsert.push({ ...m, plan_day_id: pdId }))
        }
        if(wdId && !wdWithBlocks.has(wdId)){
          const defsB = await pickWorkoutFor(i, (prof||{}) as Profile)
          defsB.forEach(b => blocksToInsert.push({ ...b, workout_day_id: wdId }))
        }
      }
      if(mealsToInsert.length) await supabase.from('meals').insert(mealsToInsert)
      if(blocksToInsert.length) await supabase.from('workout_blocks').insert(blocksToInsert)

      if (typeof window !== 'undefined') localStorage.setItem(flagKey, '1')
    }catch(e){ console.warn('ensureWeekIfNeeded error', e) }
  }

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

  async function openIngredients(meal: Meal){
    const recipe = meal.recipe_name || ''
    setIngredientsFor(recipe)
    setIngredients([])
    const { data: rec } = await supabase.from('recipes').select('*').ilike('name', recipe).maybeSingle()
    const list: string[] = (rec as Recipe | null)?.ingredients || []
    setIngredients(list || [])
  }

  async function addIngredientsToGrocery(items: string[]){
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ notify('error','Sign in first'); return }
    if(items.length===0){ notify('error','No structured ingredients found for this recipe'); return }
    const counts: Record<string, number> = {}
    for(const raw of items){ const name = normalizeName(raw); counts[name] = (counts[name]||0) + 1 }
    for(const [name, qty] of Object.entries(counts)){
      // prefer grocery_items if exists; fallback to shopping_items
      const ex = await supabase.from('grocery_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
      if(ex.data){
        const cur = (ex.data as any).quantity ?? 1
        await supabase.from('grocery_items').update({ quantity: cur + qty }).eq('id', (ex.data as any).id)
      }else{
        const ins = await supabase.from('grocery_items').insert({ user_id: user.id, name, done:false, quantity: qty })
        if((ins as any).error){
          const ex2 = await supabase.from('shopping_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
          if(ex2.data){
            const cur = (ex2.data as any).quantity ?? 1
            await supabase.from('shopping_items').update({ quantity: cur + qty }).eq('id', (ex2.data as any).id)
          }else{
            await supabase.from('shopping_items').insert({ user_id: user.id, name, done:false, quantity: qty })
          }
        }
      }
    }
    notify('success','Ingredients added (quantities updated).')
  }

  async function loadReplacements(meal: Meal){
    setReplacingId(meal.id)
    setAltOptions([])
    const p = (profile || {}) as Profile
    const tag = mealTagFor(meal)
    const current = normalizeName(meal.recipe_name||'')

    async function querySet(applyDiet:boolean, applyTag:boolean){
      let q:any = supabase.from('recipes').select('name, dietary_pattern, allergens, cuisine, tags').limit(100)
      if(applyTag){ q = q.ilike('tags', `%${tag}%`) }
      const { data } = await q
      return (data as Recipe[]) || []
    }

    let candidates: Recipe[] = []
    const orders:[boolean,boolean][] = [[true,true],[false,true],[true,false],[false,false]]
    for(const [applyDiet, applyTag] of orders){
      const set = await querySet(applyDiet, applyTag)
      const filtered = set.filter((r:Recipe)=> isRecipeAllowed(r, p) && normalizeName(r.name) !== current)
      candidates = candidates.concat(filtered)
      const seen = new Set<string>()
      candidates = candidates.filter(r => { const k = normalizeName(r.name); if(seen.has(k)) return false; seen.add(k); return true })
      if(candidates.length >= 12) break
    }

    setAltOptions(candidates.slice(0,12).map(r=>r.name))
  }

  async function replaceMeal(mealId: string, name: string){
    await supabase.from('meals').update({ recipe_name: name }).eq('id', mealId)
    setReplacingId(null); setAltOptions([])
    const { data: { user } } = await supabase.auth.getUser()
    if(user) await loadAll(user.id)
  }

  // --- UI helpers ------------------------------------------------------------
  const segBtn = (label:string, active:boolean, onClick: ()=>void) => (
    <button className={active ? 'on' : ''} onClick={onClick}>{label}</button>
  )
  const subTabBar = (value:SubTab, set:(v:SubTab)=>void) => (
    <div className="subtabs">
      <button className={value==='today'?'active':''} onClick={()=>set('today')}>Today</button>
      <button className={value==='week'?'active':''} onClick={()=>set('week')}>Week</button>
    </div>
  )

  // Render a day (used for both Today and Week views)
  function MealsList(meals: Meal[]){
    return (
      <div className="daylist">
        {meals.map(m=>(
          <div key={m.id} className="mealrow">
            <div className="mr-left">{m.meal_type || 'Meal'}</div>
            <div className="mr-right">{MEAL_TIME[m.meal_type] || '—'}</div>

            <div className="mr-second">
              <div className="mr-title">{m.recipe_name || 'TBD'}</div>
              <div className="mr-actions">
                <button className="chipbtn" onClick={()=>loadReplacements(m)}>Replace</button>
                <button className="chipbtn" onClick={()=>openIngredients(m)}>Add to grocery</button>
                <a className="chipbtn" href={recipeLink(m.recipe_name)} target="_blank" rel="noreferrer">Recipe</a>
              </div>
            </div>
          </div>
        ))}
        {meals.length===0 && <div className="muted">No meals for this day yet.</div>}
      </div>
    )
  }

  function BlocksList(blocks: WorkoutBlock[]){
    return (
      <div className="daylist">
        {blocks.map(b=>(
          <div key={b.id} className="workrow">
            <div style={{fontWeight:800}}>{b.title || b.kind || 'Block'}</div>
            <div style={{opacity:.85}}>{b.details || '—'}</div>
          </div>
        ))}
        {blocks.length===0 && <div className="muted">No workout for this day yet.</div>}
      </div>
    )
  }

  // --------------------------------------------------------------------------
  return (
    <div className="container plans-wrap" style={{display:'grid', gap:16}}>
      <h1 className="page-title">Plans</h1>

      {/* Main segmented control */}
      <div className="seg">
        {segBtn('Diet', mainTab==='diet', ()=>setMainTab('diet'))}
        {segBtn('Exercise', mainTab==='workout', ()=>setMainTab('workout'))}
      </div>

      {/* Diet panel */}
      {mainTab==='diet' && (
        <section className="panel">
          {subTabBar(dietTab, setDietTab)}

          {dietTab==='today' ? (
            MealsList(todayMeals)
          ) : (
            <>
              {/* Rolling week starting today */}
              <div className="chips" style={{marginBottom:6}}>
                {weekDates.map(d => (
                  <button key={d} className={`chip ${selectedWeekDate===d?'on':''}`} onClick={()=>setSelectedWeekDate(d)}>
                    {new Date(d).toLocaleDateString(undefined, { weekday:'short', day:'2-digit' })}
                  </button>
                ))}
              </div>
              {MealsList(weekMeals[selectedWeekDate] || [])}
            </>
          )}
        </section>
      )}

      {/* Workout panel */}
      {mainTab==='workout' && (
        <section className="panel">
          {subTabBar(workoutTab, setWorkoutTab)}

          {workoutTab==='today' ? (
            BlocksList(todayBlocks)
          ) : (
            <>
              <div className="chips" style={{marginBottom:6}}>
                {weekDates.map(d => (
                  <button key={d} className={`chip ${selectedWeekDate===d?'on':''}`} onClick={()=>setSelectedWeekDate(d)}>
                    {new Date(d).toLocaleDateString(undefined, { weekday:'short', day:'2-digit' })}
                  </button>
                ))}
              </div>
              {BlocksList(weekBlocks[selectedWeekDate] || [])}
            </>
          )}
        </section>
      )}

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

      {/* Replace modal */}
      {replacingId && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Replace meal</h3>
              <button className="icon-button" onClick={()=>{ setReplacingId(null); setAltOptions([]) }}>✕</button>
            </div>
            <div className="grid gap-2 my-3">
              {altOptions.length ? altOptions.map(name => (
                <button key={name} className="button-outline" onClick={()=>replaceMeal(replacingId!, name)}>{name}</button>
              )) : <div className="muted">No alternatives found.</div>}
            </div>
          </div>
        </div>
      )}

      {busy && <div className="muted">Refreshing…</div>}
    </div>
  )
}
