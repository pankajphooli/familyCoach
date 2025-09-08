'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

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
function normalizeName(s:string){ return s.trim().toLowerCase() }

export default function PlansPage(){
  const supabase = createClient()
  const [busy, setBusy] = useState(false)

  // tabs
  const [mainTab, setMainTab] = useState<MainTab>('diet')
  const [dietTab, setDietTab] = useState<SubTab>('today')
  const [workoutTab, setWorkoutTab] = useState<SubTab>('today')

  // data
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
  const monday = useMemo(()=> mondayOfWeek(new Date()), [])
  const weekDates = useMemo(()=> rangeMonToSun(monday).map(ymdLocal), [monday])

  function notify(kind:'error'|'success', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){
      (window as any).toast(kind, msg)
    } else {
      if(kind==='error') console.warn(msg); else console.log(msg)
    }
  }

  // Boot from cache for instant paint
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
      const profSel = 'dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
      const profRes = await supabase.from('profiles').select(profSel).eq('id', user.id).maybeSingle()
      setProfile((profRes.data || null) as any)

      await ensureWeekIfNeeded(user.id, (profRes.data || {}) as Profile)
      await loadAll(user.id)

      // cache
      try{
        const key = `plans_cache_${ymdLocal(monday)}`
        localStorage.setItem(key, JSON.stringify({ weekMeals, weekBlocks, todayMeals, todayBlocks }))
      }catch{}
    } finally { setBusy(false) }
  })() }, [])

  // === Constraint helpers ===
  function isRecipeAllowed(rec: Recipe, prof: Profile){
    const patt = (prof.dietary_pattern || '').toLowerCase()
    if(patt){
      const rp = (rec.dietary_pattern || '').toLowerCase()
      if(rp && !rp.includes(patt) && !(patt==='non_veg_chicken_only' && (rp.includes('non_veg') || rp.includes('omnivore')))){
        // allow broader non_veg for chicken-only, we'll filter meats by name below
      }
    }
    const allergies = (prof.allergies||[]).map(normalizeName)
    const dislikes = (prof.dislikes||[]).map(normalizeName)
    const cuisinePrefs = (prof.cuisine_prefs||[]).map(normalizeName)

    // allergens exclusion
    const recAllergens: string[] = (rec.allergens || []).map((x:any)=>normalizeName(String(x)))
    if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false

    // dislikes exclusion
    const nameLc = normalizeName(rec.name || '')
    if(dislikes.length && dislikes.some(d => d && nameLc.includes(d))) return false

    // meat policy: crude filter by name keywords
    const meatPolicy = (prof.meat_policy||'').toLowerCase()
    if(meatPolicy==='non_veg_chicken_only'){
      const banned = ['beef','pork','bacon','mutton','lamb','fish','salmon','tuna','prawn','shrimp','shellfish']
      if(banned.some(b => nameLc.includes(b))) return false
    }

    // prefer cuisine match but don't require
    if(cuisinePrefs.length){
      const rc = normalizeName(rec.cuisine || '')
      if(rc && !cuisinePrefs.includes(rc)){
        // keep as fallback; don't hard-exclude to avoid empty results
      }
    }
    return true
  }

  function pickFrom<T>(arr:T[], index:number, fallback:T): T{
    if(!arr.length) return fallback
    return arr[index % arr.length] || arr[0]
  }

  async function candidatesFor(tag:string, prof:Profile, limit=50): Promise<Recipe[]>{
    // pull a handful from DB then filter client-side by allergies/dislikes/policy
    let q:any = supabase.from('recipes').select('name, dietary_pattern, allergens, tags, ingredients, cuisine').limit(limit)
    q = q.ilike('tags', `%${tag}%`)
    if(prof.dietary_pattern){
      q = q.eq('dietary_pattern', prof.dietary_pattern)
    }
    const { data } = await q
    const list = (data as Recipe[]) || []
    const filtered = list.filter((rec: Recipe) => isRecipeAllowed(rec, prof))
    return filtered
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
      // simple fallback
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
      const bank = ((prof?.dietary_pattern||'').toLowerCase().includes('veg')) ? veg : omni
      const row = bank[dayIndex % bank.length]
      return [
        { meal_type: 'breakfast', recipe_name: row[0] },
        { meal_type: 'lunch',     recipe_name: row[1] },
        { meal_type: 'dinner',    recipe_name: row[2] },
      ]
    }
  }

  function isExerciseAllowed(ex: Exercise, prof:Profile){
    const eqp = (prof.equipment||[]).map(normalizeName)
    const need: string[] = (ex.equipment||[]).map((x:any)=>normalizeName(String(x)))
    const contra: string[] = (ex.contraindications||[]).map((x:any)=>normalizeName(String(x)))
    const flags = [...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalizeName)
    // equipment: allow if every needed is 'none' or included
    if(need.length && need.some(n => n!=='none' && !eqp.includes(n))) return false
    // contraindications
    if(flags.length && contra.some(c => flags.includes(c))) return false
    return true
  }

  async function pickWorkoutFor(dayIndex:number, prof:Profile){
    // build a routine from allowed exercises
    const { data } = await supabase.from('exercises').select('name,tags,equipment,contraindications,description').limit(100)
    const exs = (data as Exercise[]) || []
    const allowed = exs.filter((ex:Exercise) => isExerciseAllowed(ex, prof))
    // pick 3 different-ish
    const a = pickFrom<Exercise>(allowed, dayIndex, {name:'Glute bridge', description:'Squeeze at top. 3×12'} as Exercise)
    const b = pickFrom<Exercise>(allowed, dayIndex+3, {name:'Row (band)', description:'3×12'} as Exercise)
    const c = pickFrom<Exercise>(allowed, dayIndex+5, {name:'Plank', description:'3×30s'} as Exercise)
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
      const flagKey = `plans_ensured_monday`
      const mondayStr = ymdLocal(monday)
      const flag = typeof window !== 'undefined' ? localStorage.getItem(flagKey) : null
      if(flag === mondayStr){
        return
      }
      // Fetch existing days
      const [pds, wds] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const havePd = new Set(((pds.data||[]) as PlanDay[]).map((r)=>r.date))
      const haveWd = new Set(((wds.data||[]) as WorkoutDay[]).map((r)=>r.date))

      // Insert missing days
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
      const pdByDate: Record<string, string> = {}; ((pds2.data||[]) as PlanDay[]).forEach((r)=> pdByDate[r.date]=r.id)
      const wdByDate: Record<string, string> = {}; ((wds2.data||[]) as WorkoutDay[]).forEach((r)=> wdByDate[r.date]=r.id)

      // Fetch all meals/blocks once
      const [mealsAll, blocksAll] = await Promise.all([
        supabase.from('meals').select('id,plan_day_id').in('plan_day_id', Object.values(pdByDate)),
        supabase.from('workout_blocks').select('id,workout_day_id').in('workout_day_id', Object.values(wdByDate)),
      ])
      const pdWithMeals = new Set(((mealsAll.data||[]) as {id:string;plan_day_id:string}[]).map((m)=>m.plan_day_id))
      const wdWithBlocks = new Set(((blocksAll.data||[]) as {id:string;workout_day_id:string}[]).map((b)=>b.workout_day_id))

      // Insert missing meals/blocks with constraints
      const mealsToInsert:any[] = []
      const blocksToInsert:any[] = []
      for(let i=0;i<weekDates.length;i++){
        const date = weekDates[i]
        const pdId = pdByDate[date]; const wdId = wdByDate[date]
        if(pdId && !pdWithMeals.has(pdId)){
          const defs = await defaultsForMeals(i, prof)
          defs.forEach(m => mealsToInsert.push({ ...m, plan_day_id: pdId }))
        }
        if(wdId && !wdWithBlocks.has(wdId)){
          const defsB = await pickWorkoutFor(i, prof)
          defsB.forEach(b => blocksToInsert.push({ ...b, workout_day_id: wdId }))
        }
      }
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

  // === UI helpers ===
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

  // === Ingredients modal ===
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
    // compress same-name items and increment quantities
    const counts: Record<string, number> = {}
    for(const raw of items){
      const name = normalizeName(raw)
      counts[name] = (counts[name]||0) + 1
    }
    for(const [name, qty] of Object.entries(counts)){
      // try grocery_items first
      let ex = await supabase.from('grocery_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
      if(ex.data){
        const cur = (ex.data as any).quantity ?? 1
        await supabase.from('grocery_items').update({ quantity: cur + qty }).eq('id', (ex.data as any).id)
      }else{
        const ins = await supabase.from('grocery_items').insert({ user_id: user.id, name, done:false, quantity: qty })
        if(ins.error){
          // fallback: shopping_items (older schema)
          let ex2 = await supabase.from('shopping_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
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

  // === Replace modal ===
  async function loadReplacements(meal: Meal){
    setReplacingId(meal.id)
    setAltOptions([])
    const p = (profile || {}) as Profile
    let q: any = supabase.from('recipes').select('name, dietary_pattern, allergens, cuisine, tags').limit(50)
    if(p.dietary_pattern){ q = q.eq('dietary_pattern', p.dietary_pattern) }
    const { data } = await q
    const list = (data as Recipe[]) || []
    const filtered = list.filter((rec: Recipe)=>isRecipeAllowed(rec, p))
    setAltOptions(filtered.map((r:Recipe)=>r.name))
  }
  async function replaceMeal(mealId: string, name: string){
    await supabase.from('meals').update({ recipe_name: name }).eq('id', mealId)
    setReplacingId(null); setAltOptions([])
    const { data: { user } } = await supabase.auth.getUser()
    if(user) await loadAll(user.id)
  }

  const tabBtn = (label:string, active:boolean, onClick: ()=>void) => (
    <button
      className="button"
      onClick={onClick}
      style={active ? { } : { opacity: .7 }}
    >
      {label}
    </button>
  )

  const subTabBar = (value:SubTab, set:(v:SubTab)=>void) => (
    <div className="flex items-center gap-2">
      {tabBtn('Today', value==='today', ()=>set('today'))}
      {tabBtn('Week',  value==='week',  ()=>set('week'))}
    </div>
  )

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Plans</h1>

      {/* Primary tabs */}
      <div className="flex items-center gap-2 border-b pb-2">
        {tabBtn('Diet plan', mainTab==='diet', ()=>setMainTab('diet'))}
        {tabBtn('Exercise plan', mainTab==='workout', ()=>setMainTab('workout'))}
      </div>

      {/* DIET TAB */}
      {mainTab==='diet' && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium">Diet plan</h2>
            {subTabBar(dietTab, setDietTab)}
          </div>

          {dietTab==='today' ? (
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
      )}

      {/* WORKOUT TAB */}
      {mainTab==='workout' && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium">Exercise plan</h2>
            {subTabBar(workoutTab, setWorkoutTab)}
          </div>

          {workoutTab==='today' ? (
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
