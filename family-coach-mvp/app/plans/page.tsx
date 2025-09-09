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
    } finally { setBusy(false) }
  })() }, [])

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

    const recAllergens: string[] = (rec.allergens || []).map((x:any)=>normalizeName(String(x)))
    if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false

    const nameLc = normalizeName(rec.name || '')
    if(dislikes.length && dislikes.some(d => d && nameLc.includes(d))) return false

    const meatPolicy = (prof.meat_policy||'').toLowerCase()
    if(meatPolicy==='non_veg_chicken_only'){
      const banned = ['beef','pork','bacon','mutton','lamb','fish','salmon','tuna','prawn','shrimp','shellfish']
      if(banned.some(b => nameLc.includes(b))) return false
    }

    if(cuisinePrefs.length){
      const rc = normalizeName(rec.cuisine || '')
      if(rc && !cuisinePrefs.includes(rc)){
        // soft preference only
      }
    }
    return true
  }

  function pickFrom<T>(arr:T[], index:number, fallback:T): T{
    if(!arr.length) return fallback
    return arr[index % arr.length] || arr[0]
  }

  async function ensureWeekIfNeeded(userId: string, prof: Profile){
    const mondayStr = ymdLocal(monday)
    const flagKey = `plans_ensured_${mondayStr}`
    const flag = typeof window !== 'undefined' ? localStorage.getItem(flagKey) : null
    if(flag === '1') return

    const [pds, wds] = await Promise.all([
      supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
    ])
    const havePd = new Set(((pds.data||[]) as PlanDay[]).map(r=>r.date))
    const haveWd = new Set(((wds.data||[]) as WorkoutDay[]).map(r=>r.date))
    const missingPd = weekDates.filter(d=>!havePd.has(d)).map(date=>({ user_id: userId, date }))
    const missingWd = weekDates.filter(d=>!haveWd.has(d)).map(date=>({ user_id: userId, date }))
    await Promise.all([
      missingPd.length ? supabase.from('plan_days').insert(missingPd) : Promise.resolve(),
      missingWd.length ? supabase.from('workout_days').insert(missingWd) : Promise.resolve(),
    ])

    const [pds2, wds2] = await Promise.all([
      supabase.from('plan_days').select('id,date').eq('user_id', userId).in('date', weekDates),
      supabase.from('workout_days').select('id,date').eq('user_id', userId).in('date', weekDates),
    ])
    const pdByDate: Record<string,string> = {}; ((pds2.data||[]) as PlanDay[]).forEach(r=>pdByDate[r.date]=r.id)
    const wdByDate: Record<string,string> = {}; ((wds2.data||[]) as WorkoutDay[]).forEach(r=>wdByDate[r.date]=r.id)

    const [mealsAll, blocksAll] = await Promise.all([
      supabase.from('meals').select('id,plan_day_id').in('plan_day_id', Object.values(pdByDate)),
      supabase.from('workout_blocks').select('id,workout_day_id').in('workout_day_id', Object.values(wdByDate)),
    ])
    const haveMeals = new Set(((mealsAll.data||[]) as any[]).map(m=>m.plan_day_id))
    const haveBlocks = new Set(((blocksAll.data||[]) as any[]).map(b=>b.workout_day_id))

    const mealsToIns:any[] = []
    const blocksToIns:any[] = []
    for(let i=0;i<weekDates.length;i++){
      const d = weekDates[i]
      const pdId = pdByDate[d]; const wdId = wdByDate[d]
      if(pdId && !haveMeals.has(pdId)){
        const defs = await defaultsForMeals(i, prof)
        defs.forEach(m => mealsToIns.push({ ...m, plan_day_id: pdId }))
      }
      if(wdId && !haveBlocks.has(wdId)){
        const defsB = await pickWorkoutFor(i, prof)
        defsB.forEach(b => blocksToIns.push({ ...b, workout_day_id: wdId }))
      }
    }
    await Promise.all([
      mealsToIns.length ? supabase.from('meals').insert(mealsToIns) : Promise.resolve(),
      blocksToIns.length ? supabase.from('workout_blocks').insert(blocksToIns) : Promise.resolve(),
    ])

    if(typeof window!=='undefined') localStorage.setItem(flagKey, '1')
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

  // helpers for replacements
  function mealTagFor(meal: Meal){
    const t = (meal.meal_type||'').toLowerCase()
    if(t.includes('break')) return 'Breakfast'
    if(t.includes('lunch')) return 'Lunch'
    return 'Dinner'
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

  async function candidatesFor(tag:string, prof:Profile, limit=50): Promise<Recipe[]>{
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

  async function loadReplacements(meal: Meal){
    setReplacingId(meal.id)
    setAltOptions([])
    const p = (profile || {}) as Profile
    const tag = mealTagFor(meal)
    const current = (meal.recipe_name||'').trim().toLowerCase()

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
      const filtered = set.filter((r:Recipe)=> isRecipeAllowed(r, p) && (r.name||'').trim().toLowerCase() !== current)
      candidates = candidates.concat(filtered)
      const seen = new Set<string>()
      candidates = candidates.filter(r => {
        const k = (r.name||'').trim().toLowerCase()
        if(seen.has(k)) return false; seen.add(k); return true
      })
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

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Plans</h1>
      {/* ...your existing tab UI remains... */}

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
    </div>
  )
}
