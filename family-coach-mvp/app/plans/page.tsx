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
  const day = dd.getDay() || 7
  if(day>1){ dd.setDate(dd.getDate()-(day-1)) }
  return dd
}
function rangeMonToSun(monday: Date){
  const arr: Date[] = []
  for(let i=0;i<7;i++){ const d = new Date(monday); d.setDate(monday.getDate()+i); arr.push(d) }
  return arr
}
function normalizeName(s:string){ return (s||'').trim().toLowerCase() }
function recipeLink(name?: string | null){ if(!name) return '#'; const q = encodeURIComponent(`${name} recipe`); return `https://www.google.com/search?q=${q}` }
function mealTagFor(meal: Meal){
  const t = (meal.meal_type||'').toLowerCase()
  if(t.includes('break')) return 'Breakfast'
  if(t.includes('lunch')) return 'Lunch'
  return 'Dinner'
}
function pickFrom<T>(arr:T[], index:number, fallback:T): T{ return arr.length ? (arr[index % arr.length] || arr[0]) : fallback }

export default function PlansPage(){
  const supabase = useMemo(()=> createClient(), [])

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
  const monday = useMemo(()=> mondayOfWeek(new Date()), [])
  const weekDates = useMemo(()=> rangeMonToSun(monday).map(ymdLocal), [monday])

  function notify(kind:'error'|'success', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){
      (window as any).toast(kind, msg)
    } else {
      if(kind==='error') console.warn(msg); else console.log(msg)
    }
  }

  // Quick restore from local cache for snappy first paint
  useEffect(()=>{
    try{
      const key = `plans_cache_${ymdLocal(monday)}`
      const raw = localStorage.getItem(key)
      if(raw){
        const parsed = JSON.parse(raw)
        setWeekMeals(parsed.weekMeals||{})
        setWeekBlocks(parsed.weekBlocks||{})
        setTodayMeals(parsed.todayMeals||[])
        setTodayBlocks(parsed.todayBlocks||[])
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
      setProfile((profRes.data || null) as Profile)

      await ensureWeekIfNeeded(user.id, (profRes.data || {}) as Profile)
      await loadAll(user.id)

      try{
        const key = `plans_cache_${ymdLocal(monday)}`
        localStorage.setItem(key, JSON.stringify({ weekMeals, weekBlocks, todayMeals, todayBlocks }))
      }catch{}
    } finally { setBusy(false) }
  })() }, [])

  function isRecipeAllowed(rec: Recipe, prof: Profile){
    const patt = normalizeName(prof.dietary_pattern||'')
    const rp = normalizeName(rec.dietary_pattern||'')
    if(patt){
      if(rp && !rp.includes(patt) && !(patt==='non_veg_chicken_only' && (rp.includes('non_veg') || rp.includes('omnivore')))){
        // allow fallback; don't hard-exclude to avoid empty results
      }
    }
    const allergies = (prof.allergies||[]).map(normalizeName)
    const dislikes = (prof.dislikes||[]).map(normalizeName)

    const recAllergens: string[] = (rec.allergens || []).map((x:any)=>normalizeName(String(x)))
    if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false

    const nameLc = normalizeName(rec.name || '')
    if(dislikes.length && dislikes.some((d:string) => d && nameLc.includes(d))) return false

    const meatPolicy = normalizeName(prof.meat_policy||'')
    if(meatPolicy==='non_veg_chicken_only'){
      const banned = ['beef','pork','bacon','mutton','lamb','fish','salmon','tuna','prawn','shrimp','shellfish']
      if(banned.some((b:string) => nameLc.includes(b))) return false
    }
    return true
  }

  function isExerciseAllowed(ex: Exercise, prof:Profile){
    const eqp = (prof.equipment||[]).map(normalizeName)
    const need: string[] = (ex.equipment||[]).map((x:any)=>normalizeName(String(x)))
    const contra: string[] = (ex.contraindications||[]).map((x:any)=>normalizeName(String(x)))
    const flags = [...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalizeName)
    if(need.length && need.some((n:string) => n!=='none' && !eqp.includes(n))) return false
    if(flags.length && contra.some((c:string) => flags.includes(c))) return false
    return true
  }

  async function candidatesFor(tag:string, prof:Profile, limit=50): Promise<Recipe[]>{
    // pull a handful from DB then filter client-side by allergies/dislikes/policy
    let q:any = supabase.from('recipes').select('name, dietary_pattern, allergens, tags, ingredients, cuisine').limit(limit)
    q = q.ilike('tags', `%${tag}%`)
    if(prof.dietary_pattern){ q = q.eq('dietary_pattern', prof.dietary_pattern) }
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
      const mondayStr = ymdLocal(monday)
      const flagKey = `plans_ensured_${mondayStr}`
      const flag = typeof window !== 'undefined' ? localStorage.getItem(flagKey) : null
      if(flag === '1'){ return }

      const [pds, wds] = await Promise.all([
        supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
        supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      ])
      const havePd = new Set(((pds.data||[]) as PlanDay[]).map((r)=>r.date))
      const haveWd = new Set(((wds.data||[]) as WorkoutDay[]).map((r)=>r.date))

      const missingPd = weekDates.filter((d:string)=>!havePd.has(d)).map((date:string)=>({ user_id: userId, date }))
      const missingWd = weekDates.filter((d:string)=>!haveWd.has(d)).map((date:string)=>({ user_id: userId, date }))
      await Promise.all([
        missingPd.length ? supabase.from('plan_days').insert(missingPd) : Promise.resolve(),
        missingWd.length ? supabase.from('workout_days').insert(missingWd) : Promise.resolve(),
      ])

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
          const defs = await defaultsForMeals(i, prof)
          defs.forEach((m:any) => mealsToInsert.push({ ...m, plan_day_id: pdId }))
        }
        if(wdId && !wdWithBlocks.has(wdId)){
          const defsB = await pickWorkoutFor(i, prof)
          defsB.forEach((b:any) => blocksToInsert.push({ ...b, workout_day_id: wdId }))
        }
      }
      await Promise.all([
        mealsToInsert.length ? supabase.from('meals').insert(mealsToInsert) : Promise.resolve(),
        blocksToInsert.length ? supabase.from('workout_blocks').insert(blocksToInsert) : Promise.resolve(),
      ])

      if (typeof window !== 'undefined') localStorage.setItem(flagKey, '1')
    }catch(e){
      console.warn('ensureWeekIfNeeded error', e)
    }
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

    const byDateMeals: Record<string, Meal[]> = {}; weekDates.forEach((d:string)=> byDateMeals[d]=[])
    for(const pd of pds){ byDateMeals[pd.date] = meals.filter(m=>m.plan_day_id===pd.id) }
    const byDateBlocks: Record<string, WorkoutBlock[]> = {}; weekDates.forEach((d:string)=> byDateBlocks[d]=[])
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
      let ex = await supabase.from('grocery_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
      if(ex.data){
        const cur = (ex.data as any).quantity ?? 1
        await supabase.from('grocery_items').update({ quantity: cur + (qty as number) }).eq('id', (ex.data as any).id)
      }else{
        const ins = await supabase.from('grocery_items').insert({ user_id: user.id, name, done:false, quantity: qty as number })
        if(ins.error){
          // fallback legacy table name if present
          let ex2 = await supabase.from('shopping_items').select('id, quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
          if(ex2.data){
            const cur = (ex2.data as any).quantity ?? 1
            await supabase.from('shopping_items').update({ quantity: cur + (qty as number) }).eq('id', (ex2.data as any).id)
          }else{
            await supabase.from('shopping_items').insert({ user_id: user.id, name, done:false, quantity: qty as number })
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
      if(applyDiet && p.dietary_pattern){ q = q.eq('dietary_pattern', p.dietary_pattern) }
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

  // --- UI helpers ---
  const TabBar = ({value, set}:{value:SubTab; set:(v:SubTab)=>void}) => (
    <div className="flex items-center gap-2">
      <button className="button" onClick={()=>set('today')} style={value==='today'?{}:{opacity:.6}}>Today</button>
      <button className="button" onClick={()=>set('week')}  style={value==='week' ?{}:{opacity:.6}}>Week</button>
    </div>
  )

  const tabBtn = (label:string, active:boolean, onClick: ()=>void) => (
    <button className="button" onClick={onClick} style={active ? { } : { opacity: .6 }}>{label}</button>
  )

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Plans</h1>

      <div className="flex items-center gap-2 border-b pb-2">
        {tabBtn('Diet plan', mainTab==='diet', ()=>setMainTab('diet'))}
        {tabBtn('Exercise plan', mainTab==='workout', ()=>setMainTab('workout'))}
      </div>

      {mainTab==='diet' && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium">Diet plan</h2>
            <TabBar value={dietTab} set={setDietTab} />
          </div>

          {dietTab==='today' ? (
            <div className="grid gap-3">
              {todayMeals.length===0 && <div className="muted">No meals for today yet.</div>}
              {todayMeals.map(m=>(
                <div key={m.id} className="card row" style={{display:'grid', gap:8}}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{m.meal_type || 'Meal'} — <span className="opacity-70">{MEAL_TIME[m.meal_type] || '—'}</span></div>
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
                        <div>• {m.meal_type || 'Meal'} — <span className="opacity-70">{MEAL_TIME[m.meal_type] || '—'}</span> · <span>{m.recipe_name || 'TBD'}</span></div>
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

      {mainTab==='workout' && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium">Exercise plan</h2>
            <TabBar value={workoutTab} set={setWorkoutTab} />
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
