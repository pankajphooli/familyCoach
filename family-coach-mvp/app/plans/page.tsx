'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

type PlanMeal = { id: string; meal_type: string; recipe_name: string }
type WorkoutBlock = { id: string; type: string; movements: { name: string }[] }

export default function Plans(){
  const supabase = createClient()
  const [meals, setMeals] = useState<PlanMeal[]>([])
  const [workout, setWorkout] = useState<WorkoutBlock[]>([])
  const [dayId, setDayId] = useState<string | null>(null)
  const [wdayId, setWdayId] = useState<string | null>(null)
  const [ingredientsFor, setIngredientsFor] = useState<string|null>(null)
  const [ingredients, setIngredients] = useState<string[]>([])
  const [recipeHelp, setRecipeHelp] = useState<string>('')
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [options, setOptions] = useState<any[]>([])
  const today = new Date().toISOString().slice(0,10)
  const toast = (typeof window !== 'undefined' ? (window as any).toast : undefined)

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (day){
      setDayId(day.id as any)
      const { data: ms } = await supabase.from('plan_meals').select('id, meal_type, recipe_name').eq('plan_day_id', day.id).order('meal_type')
      setMeals((ms as any[])||[])
    } else {
      setDayId(null)
      setMeals([])
    }
    const { data: wday } = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (wday){
      setWdayId(wday.id as any)
      const { data: blocks } = await supabase.from('workout_blocks').select('id, type, movements').eq('workout_day_id', wday.id)
      setWorkout((blocks as any[])||[])
    } else {
      setWdayId(null)
      setWorkout([])
    }
  }
  useEffect(()=>{ load() }, [])

  // ---------- Immediate generators (diet + workout) ----------
  const calcKcal = (p:any) => {
    const age = p?.dob ? Math.max(18, Math.floor((Date.now() - new Date(p.dob).getTime())/(365.25*24*3600*1000))) : 30
    const w = Number(p?.weight_kg) || 70
    const h = Number(p?.height_cm) || 170
    const sex = String(p?.sex || 'male').toLowerCase()
    const bmr = sex==='female' ? (10*w + 6.25*h - 5*age - 161) : (10*w + 6.25*h - 5*age + 5)
    const multMap:any = { 'sedentary (little/no exercise)':1.2,'lightly active (1-3 days/week)':1.375,'moderately active (3-5 days/week)':1.55,'very active (6-7 days/week)':1.725,'athlete (2x/day)':1.9 }
    const mult = multMap[p?.activity_level || 'sedentary (little/no exercise)'] || 1.2
    let total = Math.round(bmr*mult)
    const goal = String(p?.primary_goal||'').toLowerCase()
    if (goal.includes('fat')) total = Math.round(total*0.85)
    if (goal.includes('muscle')) total = Math.round(total*1.10)
    return total
  }

  const generateDietToday = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ toast && toast('error','Sign in first'); return }
    const { data: exists } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (exists){ toast && toast('info', 'Diet already exists for today'); return }

    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    const total_kcal = calcKcal(p)
    const ins = await supabase.from('plan_days').insert({ user_id: user.id, date: today, total_kcal }).select().single()
    if (ins.error){ toast && toast('error', ins.error.message); return }
    const id = ins.data.id

    const pattern = String(p?.dietary_pattern||'non-veg').toLowerCase()
    const isVeg = pattern.includes('veg') && !pattern.includes('non-veg')
    const meals = [
      { meal_type:'breakfast', recipe_name: isVeg ? 'Veg Oats Bowl' : 'Scrambled Eggs' },
      { meal_type:'lunch', recipe_name: isVeg ? 'Paneer Bowl' : 'Grilled Chicken Bowl' },
      { meal_type:'snack', recipe_name: 'Greek Yogurt & Fruit' },
      { meal_type:'dinner', recipe_name: isVeg ? 'Tofu Stir-fry' : 'Salmon & Veg' },
    ]
    await supabase.from('plan_meals').insert(meals.map(m=>({ ...m, plan_day_id: id })))
    toast && toast('success','Diet plan generated')
    await load()
  }

  const generateWorkoutToday = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ toast && toast('error','Sign in first'); return }
    const { data: exists } = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (exists){ toast && toast('info', 'Workout already exists for today'); return }
    const ins = await supabase.from('workout_days').insert({ user_id: user.id, date: today }).select().single()
    if (ins.error){ toast && toast('error', ins.error.message); return }
    const id = ins.data.id
    const blocks = [
      { type:'Warm-up', movements:[{name:'Joint mobility flow'}] },
      { type:'Circuit', movements:[{name:'Glute bridges'},{name:'Step-ups (low box)'},{name:'Wall push-ups'}] },
      { type:'Cool-down', movements:[{name:'Joint mobility flow'}] }
    ]
    await supabase.from('workout_blocks').insert(blocks.map(b=>({ ...b, workout_day_id: id })))
    toast && toast('success','Workout generated')
    await load()
  }

  // ---------- UI helpers ----------
  const openIngredients = async (meal:PlanMeal) => {
    const { data: rec } = await supabase.from('recipes').select('ingredients, url').ilike('name', meal.recipe_name).maybeSingle()
    const parts = rec?.ingredients ? rec.ingredients.split(',').map((s:string)=>s.trim()).filter(Boolean) : []
    setIngredients(parts); setIngredientsFor(meal.id)
    let help = ''
    if (rec && 'url' in rec && rec.url) help = rec.url as any
    else help = 'https://www.google.com/search?q=' + encodeURIComponent(meal.recipe_name + ' recipe')
    setRecipeHelp(help)
  }

  const addIngredient = async (name:string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ toast && toast('error','Sign in first'); return }
    const { data: prof } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if(!prof?.family_id){ toast && toast('error','Join or create a family first'); return }
    await supabase.from('grocery_items').insert({ family_id: prof.family_id, name })
    toast && toast('success','Added ' + name)
  }

  const loadReplacements = async (meal:PlanMeal) => {
    setReplacingId(meal.id)
    const { data: recs } = await supabase.from('recipes').select('id,name').ilike('meal_type', meal.meal_type).limit(6)
    setOptions(recs||[])
  }

  const replaceMeal = async (meal:PlanMeal, recipe_name:string) => {
    const { error } = await supabase.from('plan_meals').update({ recipe_name }).eq('id', meal.id)
    if (error) { toast && toast('error', error.message); return }
    setReplacingId(null); setOptions([])
    await load()
    toast && toast('success','Meal swapped 🤝')
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Diet plan for today</h2>
        {!dayId && (
          <div style={{marginBottom:12}}>
            <button className="button" onClick={generateDietToday}>Generate today’s diet</button>
            <small className="muted" style={{display:'block',marginTop:6}}>Weekly auto‑generation runs Friday 18:00 UTC for the week starting Monday.</small>
          </div>
        )}
        <div className="grid">
          {meals.length===0 && dayId && <p className="muted">No meals saved for today.</p>}
          {meals.map(m => (
            <div key={m.id} className="card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><b>{m.meal_type}</b></div>
                <a href={"https://www.google.com/search?q=" + encodeURIComponent(m.recipe_name + " recipe")} target="_blank" rel="noreferrer" className="muted">Recipe help ↗</a>
              </div>
              <div>{m.recipe_name}</div>
              <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
                <button className="button" onClick={()=>openIngredients(m)}>Pick Ingredients</button>
                <button className="button" onClick={()=>loadReplacements(m)}>Replace</button>
              </div>
              {ingredientsFor===m.id && (
                <div className="card" style={{marginTop:8}}>
                  {ingredients.length===0 ? <small className="muted">No ingredients listed for this recipe.</small> : ingredients.map((ing,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'6px 0'}}>
                      <span>{ing}</span><button className='button' onClick={()=>addIngredient(ing)}>Add</button>
                    </div>
                  ))}
                  {recipeHelp && <a href={recipeHelp} target="_blank" rel="noreferrer" className="muted">Open recipe ↗</a>}
                </div>
              )}
              {replacingId===m.id && (
                <div className="card" style={{marginTop:8}}>
                  {options.length===0 ? <small className="muted">Loading...</small> : options.map(o => (
                    <button key={o.id} className="button" onClick={()=>replaceMeal(m,o.name)} style={{marginRight:8}}>{o.name}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Workout for today</h2>
        {!wdayId && (
          <div style={{marginBottom:12}}>
            <button className="button" onClick={generateWorkoutToday}>Generate today’s workout</button>
          </div>
        )}
        {workout.length===0 && wdayId && <p className="muted">No workout saved for today.</p>}
        <div className="grid">
          {workout.map((b)=>(
            <div key={b.id} className="card">
              <b>{b.type}</b>
              <div style={{marginTop:6}}>
                {Array.isArray(b.movements) ? b.movements.map((mv:any,idx:number)=>(
                  <div key={idx} className="card" style={{marginTop:6}}>
                    <Movement name={mv.name} />
                  </div>
                )) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Movement({ name }: { name: string }){
  const [info, setInfo] = useState<any>(null)
  const supabase = createClient()
  useEffect(()=>{ supabase.from('exercises').select('*').eq('name', name).maybeSingle().then(({data})=> setInfo(data)) }, [name])
  return (
    <div style={{display:'flex',gap:12,alignItems:'center'}}>
      {info?.image_url && <img src={info.image_url} alt={name} style={{width:64,height:64,objectFit:'cover',borderRadius:8}} />}
      <div>
        <div><b>{name}</b></div>
        <small className="muted">{info?.description || 'Guided movement'}</small>
      </div>
    </div>
  )
}
