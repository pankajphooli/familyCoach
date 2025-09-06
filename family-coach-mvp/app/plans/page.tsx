'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

function Movement({ name }: { name: string }){
  const [info, setInfo] = useState<any>(null)
  const supabase = createClient()
  useEffect(()=>{ supabase.from('exercises').select('*').eq('name', name).maybeSingle().then(({data})=> setInfo(data)) }, [name])
  return (
    <div className="card" style={{marginTop:6}}>
      <div style={{display:'flex',gap:12,alignItems:'center'}}>
        {info?.image_url && <img src={info.image_url} alt={name} style={{width:64,height:64,objectFit:'cover',borderRadius:8}} />}
        <div>
          <div><b>{name}</b></div>
          <small className="muted">{info?.description || 'Guided movement'}</small>
        </div>
      </div>
    </div>
  )
}

export default function Plans(){
  const supabase = createClient()
  const [meals, setMeals] = useState<any[]>([])
  const [workout, setWorkout] = useState<any[]>([])
  const [ingredientsFor, setIngredientsFor] = useState<string|null>(null)
  const [ingredients, setIngredients] = useState<string[]>([])
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [options, setOptions] = useState<any[]>([])
  const today = new Date().toISOString().slice(0,10)

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (day){
      const { data: ms } = await supabase.from('plan_meals').select('*').eq('plan_day_id', day.id)
      setMeals(ms||[])
    } else {
      setMeals([])
    }
    const { data: wday } = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    if (wday){
      const { data: blocks } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', wday.id)
      setWorkout(blocks||[])
    } else {
      setWorkout([])
    }
  }
  useEffect(()=>{ load() }, [])

  const openIngredients = async (meal:any) => {
    const { data: rec } = await supabase.from('recipes').select('ingredients').ilike('name', meal.recipe_name).maybeSingle()
    const parts = rec?.ingredients ? rec.ingredients.split(',').map((s:string)=>s.trim()).filter(Boolean) : []
    setIngredients(parts)
    setIngredientsFor(meal.id)
  }

  const addIngredient = async (name:string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ (window as any).toast?.('error','Sign in first'); return }
    const { data: prof } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if(!prof?.family_id){ (window as any).toast?.('error','Join or create a family first'); return }
    await supabase.from('grocery_items').insert({ family_id: prof.family_id, name })
    ;(window as any).toast?.('success','Added ' + name)
  }

  const loadReplacements = async (meal:any) => {
    setReplacingId(meal.id)
    const { data: recs } = await supabase.from('recipes').select('id,name').ilike('meal_type', meal.meal_type).limit(6)
    setOptions(recs||[])
  }

  const replaceMeal = async (meal:any, recipe_name:string) => {
    const { error } = await supabase.from('plan_meals').update({ recipe_name }).eq('id', meal.id)
    if (error) { (window as any).toast?.('error', error.message); return }
    setReplacingId(null); setOptions([])
    await load()
    ;(window as any).toast?.('success','Meal swapped 🤝')
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Diet plan for today</h2>
        <div className="grid">
          {meals.length===0 && <p className="muted">No plan yet.</p>}
          {meals.map(m => (
            <div key={m.id} className="card">
              <div><b>{m.meal_type}</b></div>
              <div>{m.recipe_name}</div>
              <div style={{display:'flex',gap:8,marginTop:8}}>
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
        {workout.length===0 && <p className="muted">No workout yet.</p>}
        <div className="grid">
          {workout.map((b:any)=>(
            <div key={b.id} className="card">
              <b>{b.type}</b>
              <div style={{marginTop:6}}>
                {Array.isArray(b.movements) ? b.movements.map((mv:any,idx:number)=>(
                  <Movement key={idx} name={mv.name} />
                )) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
