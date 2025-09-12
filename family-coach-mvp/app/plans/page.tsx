'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
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
  breakfast: '08:00 - 09:00',
  snack: '10:30 - 11:00',
  lunch: '12:30 - 13:30',
  snack_pm: '16:00 - 16:30',
  dinner: '18:30 - 19:30'
}

function nextNDatesFromToday(n:number){
  const s = new Date();
  const out:string[] = [];
  for (let i=0;i<n;i++){ const d = new Date(s); d.setDate(s.getDate()+i); out.push(
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  );}
  return out;
}

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
const weekDates = useMemo(()=> nextNDatesFromToday(7), []);
const [selectedWeekDate, setSelectedWeekDate] = useState(weekDates[0]);

function normalizeName(s:string){ return (s||'').trim().toLowerCase() }
function recipeLink(name?: string | null){ if(!name) return '#'; const q = encodeURIComponent(`${name} recipe`); return `https://www.google.com/search?q=${q}` }
function mealLabel(meal_type?: string | null){
  const t = (meal_type||'').toLowerCase()
  if(t.includes('break')) return 'Breakfast'
  if(t.includes('lunch')) return 'Lunch'
  if(t.includes('snack')) return 'Snack'
  if(t.includes('din')) return 'Dinner'
  return 'Meal'
}
function pickFrom<T>(arr:T[], index:number, fallback:T): T{ return arr.length ? (arr[index % arr.length] || arr[0]) : fallback }

export default function PlansPage(){
  const supabase = useMemo(()=> createClient(), [])
  const [busy, setBusy] = useState(false)

  const [mainTab, setMainTab] = useState<MainTab>('diet')
  const [dietTab, setDietTab] = useState<SubTab>('week')
  const [workoutTab, setWorkoutTab] = useState<SubTab>('week')

  const [todayMeals, setTodayMeals] = useState<Meal[]>([])
  const [weekMeals, setWeekMeals] = useState<Record<string, Meal[]>>({})
  const [todayBlocks, setTodayBlocks] = useState<WorkoutBlock[]>([])
  const [weekBlocks, setWeekBlocks] = useState<Record<string, WorkoutBlock[]>>({})
  const [ingredientsFor, setIngredientsFor] = useState<string>('')   // only used for modal (optional)
  const [ingredients, setIngredients] = useState<string[]>([])
  const [replacingId, setReplacingId] = useState<string|null>(null)
  const [altOptions, setAltOptions] = useState<string[]>([])
  const [profile, setProfile] = useState<Profile|any>({})

  

  const todayStr = useMemo(()=> ymdLocal(new Date()), [])

  function mondayOfWeek(d: Date){
    // We intentionally start the “week” at TODAY (not Monday) for a rolling 7-day view
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  
  function rangeMonToSun(start: Date){
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      out.push(x);
    }
    return out;
  }


  
  const monday = useMemo(()=> mondayOfWeek(new Date()), [])
  const weekDates = useMemo(()=> rangeMonToSun(monday).map(ymdLocal), [monday])
  const [weekSel, setWeekSel] = useState<string>(todayStr)

  function notify(kind:'error'|'success', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){ (window as any).toast(kind, msg) }
    else { if(kind==='error') console.warn(msg); else console.log(msg) }
  }

  // Restore cached results for fast paint
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
      setProfile(profRes.data || {})

      await ensureWeekIfNeeded(user.id, (profRes.data || {}) as Profile)
      await loadAll(user.id)

      try{
        const key = `plans_cache_${ymdLocal(monday)}`
        localStorage.setItem(key, JSON.stringify({ weekMeals, weekBlocks, todayMeals, todayBlocks }))
      }catch{}
    } finally { setBusy(false) }
  })() }, [])

  // ---- Constraints helpers ----
  function isRecipeAllowed(rec: Recipe, prof: Profile){
    const patt = normalizeName(prof?.dietary_pattern||'')
    const rp = normalizeName(rec?.dietary_pattern||'')
    if(patt){
      if(rp && !rp.includes(patt) && !(patt==='non_veg_chicken_only' && (rp.includes('non_veg') || rp.includes('omnivore')))){
        // allow fallback so we don't end empty
      }
    }
    const allergies = (prof?.allergies||[]).map(normalizeName)
    const dislikes = (prof?.dislikes||[]).map(normalizeName)
    const recAllergens: string[] = (rec?.allergens || []).map((x:any)=>normalizeName(String(x)))
    if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false
    const nameLc = normalizeName(rec?.name || '')
    if(dislikes.length && dislikes.some((d:string) => d && nameLc.includes(d))) return false
    const meatPolicy = normalizeName(prof?.meat_policy||'')
    if(meatPolicy==='non_veg_chicken_only'){
      const banned = ['beef','pork','bacon','mutton','lamb','fish','salmon','tuna','prawn','shrimp','shellfish']
      if(banned.some((b:string) => nameLc.includes(b))) return false
    }
    return true
  }

  function isExerciseAllowed(ex: Exercise, prof:Profile){
    const eqp = (prof?.equipment||[]).map(normalizeName)
    const need: string[] = (ex.equipment||[]).map((x:any)=>normalizeName(String(x)))
    const contra: string[] = (ex.contraindications||[]).map((x:any)=>normalizeName(String(x)))
    const flags = [...(prof?.injuries||[]), ...(prof?.health_conditions||[])].map(normalizeName)
    if(need.length && need.some((n:string) => n!=='none' && !eqp.includes(n))) return false
    if(flags.length && contra.some((c:string) => flags.includes(c))) return false
    return true
  }

  async function candidatesFor(tag:string, prof:Profile, limit=50): Promise<Recipe[]>{
    let q:any = supabase.from('recipes').select('name, dietary_pattern, allergens, tags, ingredients, cuisine').limit(limit)
    q = q.ilike('tags', `%${tag}%`)
    if(prof?.dietary_pattern){ q = q.eq('dietary_pattern', prof.dietary_pattern) }
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

  // ——— Actions ———
  async function addMealIngredientsToGrocery(meal: Meal){
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ notify('error','Sign in first'); return }
    const recipe = meal.recipe_name || ''
    const { data: rec } = await supabase.from('recipes').select('*').ilike('name', recipe).maybeSingle()
    const list: string[] = (rec as Recipe | null)?.ingredients || []
    if(!list.length){ notify('error','No structured ingredients found for this recipe'); return }
    await addIngredientsToGrocery(list)
  }

  async function addIngredientsToGrocery(items: string[]){
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ notify('error','Sign in first'); return }
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
          // legacy fallback
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
    const tag = mealLabel(meal.meal_type)
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

  // Fetch a recipe's ingredients and open the modal
async function openIngredients(meal: Meal){
  const recipe = meal.recipe_name || ''
  setIngredientsFor(recipe)
  setIngredients([])

  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .ilike('name', recipe)
    .maybeSingle()

  if (error) {
    notify('error', `Could not load ingredients: ${error.message}`)
    return
  }

  const list: string[] = (data as Recipe | null)?.ingredients || []
  setIngredients(list || [])
}

  // ---------- UI helpers ----------
  const Segmented = ({value,onChange}:{value:MainTab; onChange:(v:MainTab)=>void}) => (
    <div className="seg">
      <button className={value==='diet'?'on':''} onClick={()=>onChange('diet')}>Diet</button>
      <button className={value==='workout'?'on':''} onClick={()=>onChange('workout')}>Exercise</button>
    </div>
  )
  const SubTabs = ({value,onChange}:{value:SubTab; onChange:(v:SubTab)=>void}) => (
    <div className="subtabs">
      <button className={value==='today'?'active':''} onClick={()=>onChange('today')}>Today</button>
      <button className={value==='week'?'active':''} onClick={()=>onChange('week')}>Week</button>
    </div>
  )
  function fmtDateChip(s:string){
    const d = new Date(s+'T00:00:00')
    const dd = String(d.getDate()).padStart(2,'0')
    const short = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
    return `${short} ${dd}`
  }
  const DateChips = ({sel,onSel}:{sel:string; onSel:(s:string)=>void}) => (
    <div className="chips">
      {weekDates.map((d:string) => <button key={d} className={d===sel?'chip on':'chip'} onClick={()=>onSel(d)}>{fmtDateChip(d)}</button>)}
    </div>
  )

  const MealRow = ({m}:{m:Meal}) => (
    <div className="mealrow">
      <div className="mr-top">
        <div className="mr-left">{m.meal_type || 'Meal'}</div>
        <div className="mr-right">{MEAL_TIME[m.meal_type] || '—'}</div>
      </div>
    
      <div className="mr-second">
        <div className="mr-title">{m.recipe_name || 'TBD'}</div>
        <div className="mr-actions">
          <button className="chipbtn" onClick={()=>loadReplacements(m)}>Replace</button>
          <button className="chipbtn" onClick={()=>openIngredients(m)}>Add to grocery</button>
          <a className="chipbtn" href={recipeLink(m.recipe_name)} target="_blank" rel="noreferrer">Recipe</a>
        </div>
      </div>
    </div>
  )

  const DayMeals = ({date}:{date:string}) => {
    const meals = weekMeals[date] || []
    const order = ['breakfast','snack','lunch','snack_pm','dinner']
    const sorted = [...meals].sort((a,b)=> order.indexOf(a.meal_type||'') - order.indexOf(b.meal_type||''))
    return (
      <div className="daylist">
        {sorted.map((m:Meal) => <MealRow key={m.id} m={m} />)}
        {sorted.length===0 && <div className="muted" style={{padding:'8px 2px'}}>No meals for this day.</div>}
      </div>
    )
  }

  const WorkoutList = ({date}:{date:string}) => {
    const blocks = weekBlocks[date] || []
    return (
      <div className="daylist">
        {blocks.map((b:WorkoutBlock) => (
          <div key={b.id} className="workrow">
            <div className="mr-left">{b.title || b.kind || 'Block'}</div>
            <div className="mr-right">{b.details || ''}</div>
          </div>
        ))}
        {blocks.length===0 && <div className="muted" style={{padding:'8px 2px'}}>No workout for this day.</div>}
      </div>
    )
  }

  return (
    <div className="container plans-wrap">
      <h1 className="page-title">Plans</h1>

      <Segmented value={mainTab} onChange={setMainTab} />
      {mainTab==='diet'
        ? <SubTabs value={dietTab} onChange={setDietTab} />
        : <SubTabs value={workoutTab} onChange={setWorkoutTab} />}

      {mainTab==='diet' && (
        <div className="panel">
          {dietTab==='today'
            ? <DayMeals date={todayStr} />
            : (<>
                <DateChips sel={weekSel} onSel={setWeekSel} />
                <DayMeals date={weekSel} />
              </>)
          }
        </div>
      )}

      {mainTab==='workout' && (
        <div className="panel">
          {workoutTab==='today'
            ? <WorkoutList date={todayStr} />
            : (<>
                <DateChips sel={weekSel} onSel={setWeekSel} />
                <WorkoutList date={weekSel} />
              </>)
          }
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
              {altOptions.length
                ? altOptions.map((name:string) => (
                    <button key={name} className="button-outline" onClick={()=>replaceMeal(replacingId!, name)}>{name}</button>
                  ))
                : <div className="muted">No alternatives found.</div>}
            </div>
          </div>
        </div>
      )}

      {busy && <div className="muted" style={{marginTop:8}}>Refreshing…</div>}
    </div>
  )
}
