'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string }
type WorkoutBlock = { id: string; workout_day_id: string; type: string; movements: { name: string }[] }
type DayMeals = { date: string; meals: Meal[] }
type DayBlocks = { date: string; blocks: WorkoutBlock[] }

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function mondayOfWeekContaining(d: Date){ const dow=d.getDay()||7; const mon=new Date(d); mon.setDate(d.getDate()-(dow-1)); mon.setHours(0,0,0,0); return mon }
function datesMonToSun(mon: Date){ return Array.from({length:7},(_,i)=>{ const x=new Date(mon); x.setDate(mon.getDate()+i); return x }) }

export default function Plans(){
  const supabase = createClient()
  const [status,setStatus]=useState<string>('idle')
  const [lastError,setLastError]=useState<string>('')
  const notify=(type:'success'|'error'|'info',text:string)=>{ if(typeof window!=='undefined'&&(window as any).toast) (window as any).toast(type,text); else alert(`${type.toUpperCase()}: ${text}`) }

  const [dietView,setDietView]=useState<'today'|'week'>('today')
  const [workoutView,setWorkoutView]=useState<'today'|'week'>('today')

  const [todayMeals,setTodayMeals]=useState<Meal[]>([])
  const [weekMeals,setWeekMeals]=useState<DayMeals[]>([])
  const [todayBlocks,setTodayBlocks]=useState<WorkoutBlock[]>([])
  const [weekBlocks,setWeekBlocks]=useState<DayBlocks[]>([])

  const [ingredientsFor,setIngredientsFor]=useState<string|null>(null)
  const [ingredients,setIngredients]=useState<string[]>([])
  const [recipeHelp,setRecipeHelp]=useState<string>('')
  const [replacingId,setReplacingId]=useState<string|null>(null)
  const [options,setOptions]=useState<any[]>([])

  const todayStr=useMemo(()=> ymdLocal(new Date()), [])

  useEffect(()=>{ loadAll() },[])

  async function loadAll(){
    try{
      setStatus('loading'); setLastError('')
      const { data: { user }, error: uerr } = await supabase.auth.getUser(); if(uerr) throw uerr; if(!user){ setStatus('no-user'); return }
      const dayQ = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', todayStr).maybeSingle(); if(dayQ.error) throw dayQ.error
      if(dayQ.data){ const msQ=await supabase.from('plan_meals').select('id,plan_day_id,meal_type,recipe_name').eq('plan_day_id', dayQ.data.id).order('meal_type'); if(msQ.error) throw msQ.error; setTodayMeals((msQ.data as any[])||[]) } else setTodayMeals([])
      const wdayQ=await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', todayStr).maybeSingle(); if(wdayQ.error) throw wdayQ.error
      if(wdayQ.data){ const blocksQ=await supabase.from('workout_blocks').select('id,workout_day_id,type,movements').eq('workout_day_id', wdayQ.data.id); if(blocksQ.error) throw blocksQ.error; setTodayBlocks((blocksQ.data as any[])||[]) } else setTodayBlocks([])
      const mon=mondayOfWeekContaining(new Date()); const weekDates=datesMonToSun(mon).map(ymdLocal)
      const daysQ=await supabase.from('plan_days').select('id,date').eq('user_id', user.id).in('date', weekDates); if(daysQ.error) throw daysQ.error
      const mapDayId:Record<string,string>={}; for(const d of (daysQ.data||[])) mapDayId[(d as any).date]=(d as any).id
      const ids=Object.values(mapDayId)
      if(ids.length){ const allMealsQ=await supabase.from('plan_meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id',ids); if(allMealsQ.error) throw allMealsQ.error
        const grouped:Record<string,Meal[]>={}; for(const m of (allMealsQ.data as any[])||[]){ const date=Object.keys(mapDayId).find(dt=>mapDayId[dt]===(m as any).plan_day_id)||'unknown'; (grouped[date] ||= []).push(m as any) }
        setWeekMeals(weekDates.map(dt=>({date:dt, meals: grouped[dt]||[]})))
      } else setWeekMeals(weekDates.map(dt=>({date:dt,meals:[]})))
      const wdaysQ=await supabase.from('workout_days').select('id,date').eq('user_id', user.id).in('date', weekDates); if(wdaysQ.error) throw wdaysQ.error
      const wMap:Record<string,string>={}; for(const d of (wdaysQ.data||[])) wMap[(d as any).date]=(d as any).id
      const wIds=Object.values(wMap)
      if(wIds.length){ const allBlocksQ=await supabase.from('workout_blocks').select('id,workout_day_id,type,movements').in('workout_day_id',wIds); if(allBlocksQ.error) throw allBlocksQ.error
        const grouped:Record<string,WorkoutBlock[]>={}; for(const b of (allBlocksQ.data as any[])||[]){ const date=Object.keys(wMap).find(dt=>wMap[dt]===(b as any).workout_day_id)||'unknown'; (grouped[date] ||= []).push(b as any) }
        setWeekBlocks(weekDates.map(dt=>({date:dt, blocks: grouped[dt]||[]})))
      } else setWeekBlocks(weekDates.map(dt=>({date:dt,blocks:[]})))
      setStatus('ready')
    }catch(e:any){ console.error('loadAll error',e); setLastError(e?.message||String(e)); setStatus('error') }
  }

  function kcalFromProfile(p:any){ const age=p?.dob?Math.max(18,Math.floor((Date.now()-new Date(p.dob).getTime())/(365.25*24*3600*1000))):30; const w=Number(p?.weight_kg)||70, h=Number(p?.height_cm)||170; const sex=String(p?.sex||'male').toLowerCase(); const bmr=sex==='female'?(10*w+6.25*h-5*age-161):(10*w+6.25*h-5*age+5); const multMap:any={'sedentary (little/no exercise)':1.2,'lightly active (1-3 days/week)':1.375,'moderately active (3-5 days/week)':1.55,'very active (6-7 days/week)':1.725,'athlete (2x/day)':1.9}; const mult=multMap[p?.activity_level||'sedentary (little/no exercise)']||1.2; let total=Math.round(bmr*mult); const goal=String(p?.primary_goal||'').toLowerCase(); if(goal.includes('fat')) total=Math.round(total*0.85); if(goal.includes('muscle')) total=Math.round(total*1.10); return total }

  async function ensureDietForDate(user_id:string,date:string){
    const existing=await supabase.from('plan_days').select('id').eq('user_id',user_id).eq('date',date).maybeSingle(); if(existing.error) throw existing.error; if(existing.data) return
    const profQ=await supabase.from('profiles').select('*').eq('id',user_id).maybeSingle(); if(profQ.error) throw profQ.error
    const total_kcal=kcalFromProfile(profQ.data)
    const ins=await supabase.from('plan_days').insert({user_id,date,total_kcal}).select().single(); if(ins.error) throw ins.error
    const pattern=String((profQ.data as any)?.dietary_pattern||'non-veg').toLowerCase(); const isVeg=pattern.includes('veg') && !pattern.includes('non-veg')
    const meals=[{meal_type:'breakfast',recipe_name:isVeg?'Veg Oats Bowl':'Scrambled Eggs'},{meal_type:'lunch',recipe_name:isVeg?'Paneer Bowl':'Grilled Chicken Bowl'},{meal_type:'snack',recipe_name:'Greek Yogurt & Fruit'},{meal_type:'dinner',recipe_name:isVeg?'Tofu Stir-fry':'Salmon & Veg'}]
    const pm=await supabase.from('plan_meals').insert(meals.map(m=>({...m,plan_day_id:ins.data.id}))); if(pm.error) throw pm.error
  }
  async function ensureWorkoutForDate(user_id:string,date:string){
    const existing=await supabase.from('workout_days').select('id').eq('user_id',user_id).eq('date',date).maybeSingle(); if(existing.error) throw existing.error; if(existing.data) return
    const ins=await supabase.from('workout_days').insert({user_id,date}).select().single(); if(ins.error) throw ins.error
    const blocks=[{type:'Warm-up',movements:[{name:'Joint mobility flow'}]},{type:'Circuit',movements:[{name:'Glute bridges'},{name:'Step-ups (low box)'},{name:'Wall push-ups'}]},{type:'Cool-down',movements:[{name:'Breathing & stretch'}]}]
    const wb=await supabase.from('workout_blocks').insert(blocks.map(b=>({...b,workout_day_id:ins.data.id}))); if(wb.error) throw wb.error
  }

  const [busyDiet,setBusyDiet]=useState(false)
  const [busyWorkout,setBusyWorkout]=useState(false)

  async function onGenerateDietToday(){ setBusyDiet=TrueSafe(setBusyDiet,true); await handle(async()=>{ const {data:{user}}=await supabase.auth.getUser(); if(!user){notify('error','Sign in first'); return} await ensureDietForDate(user.id,todayStr); notify('success','Diet generated for today'); await loadAll() }) }
  async function onGenerateDietWeek(){ setBusyDiet=TrueSafe(setBusyDiet,true); await handle(async()=>{ const {data:{user}}=await supabase.auth.getUser(); if(!user){notify('error','Sign in first'); return} const mon=mondayOfWeekContaining(new Date()); for(const d of datesMonToSun(mon)) await ensureDietForDate(user.id, ymdLocal(d)); notify('success','Diet generated for this week'); await loadAll() }) }
  async function onGenerateWorkoutToday(){ setBusyWorkout=TrueSafe(setBusyWorkout,true); await handle(async()=>{ const {data:{user}}=await supabase.auth.getUser(); if(!user){notify('error','Sign in first'); return} await ensureWorkoutForDate(user.id,todayStr); notify('success','Workout generated for today'); await loadAll() }) }
  async function onGenerateWorkoutWeek(){ setBusyWorkout=TrueSafe(setBusyWorkout,true); await handle(async()=>{ const {data:{user}}=await supabase.auth.getUser(); if(!user){notify('error','Sign in first'); return} const mon=mondayOfWeekContaining(new Date()); for(const d of datesMonToSun(mon)) await ensureWorkoutForDate(user.id, ymdLocal(d)); notify('success','Workout generated for this week'); await loadAll() }) }

  async function handle(fn:()=>Promise<void>){ try{ setLastError(''); await fn() } catch(e:any){ console.error(e); setLastError(e?.message||String(e)); notify('error','Error: '+(e?.message||'')) } finally { setBusyDiet(false); setBusyWorkout(false) } }
  function TrueSafe(setter:(v:boolean)=>void, v:boolean){ try{ setter(v) }catch{} return true }

  async function openIngredients(meal:Meal){
    const rec=await supabase.from('recipes').select('ingredients, url').ilike('name',meal.recipe_name).maybeSingle()
    if(rec.error){ setLastError(rec.error.message); return }
    const parts=rec.data?.ingredients ? rec.data.ingredients.split(',').map((s:string)=>s.trim()).filter(Boolean) : []
    setIngredients(parts); setIngredientsFor(meal.id)
    setRecipeHelp((rec.data as any)?.url || ('https://www.google.com/search?q='+encodeURIComponent(meal.recipe_name+' recipe')))
  }
  async function addIngredient(name:string){
    const {data:{user}}=await supabase.auth.getUser(); if(!user){ notify('error','Sign in first'); return }
    const prof=await supabase.from('profiles').select('family_id').eq('id',user.id).maybeSingle(); if(prof.error){ setLastError(prof.error.message); return }
    if(!prof.data?.family_id){ notify('error','Join or create a family first'); return }
    const ins=await supabase.from('grocery_items').insert({family_id:prof.data.family_id,name}); if(ins.error){ setLastError(ins.error.message); notify('error','Add failed'); return }
    notify('success','Added '+name)
  }
  async function loadReplacements(meal:Meal){
    setReplacingId(meal.id)
    const recs=await supabase.from('recipes').select('id,name').ilike('meal_type', meal.meal_type).limit(6); if(recs.error){ setLastError(recs.error.message); return }
    setOptions(recs.data||[])
  }
  async function replaceMeal(meal:Meal, recipe_name:string){
    const upd=await supabase.from('plan_meals').update({recipe_name}).eq('id',meal.id); if(upd.error){ setLastError(upd.error.message); notify('error','Replace failed'); return }
    setReplacingId(null); setOptions([]); await loadAll(); notify('success','Meal swapped 🤝')
  }

  function MealsList({ meals }:{ meals: Meal[] }){
    if(meals.length===0) return <p className="muted">No meals saved for this day.</p>
    return (<div className="grid">{meals.map(m=>(
      <div key={m.id} className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><b>{m.meal_type}</b></div>
          <a href={"https://www.google.com/search?q="+encodeURIComponent(m.recipe_name+" recipe")} target="_blank" rel="noreferrer" className="muted">Recipe help ↗</a>
        </div>
        <div>{m.recipe_name}</div>
        <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
          <button className="button" onClick={()=>openIngredients(m)}>Pick Ingredients</button>
          <button className="button" onClick={()=>loadReplacements(m)}>Replace</button>
        </div>
        {ingredientsFor===m.id && (<div className="card" style={{marginTop:8}}>
          {ingredients.length===0 ? <small className="muted">No ingredients listed for this recipe.</small> : ingredients.map((ing,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'6px 0'}}>
              <span>{ing}</span><button className='button' onClick={()=>addIngredient(ing)}>Add</button>
            </div>
          ))}
          {recipeHelp && <a href={recipeHelp} target="_blank" rel="noreferrer" className="muted">Open recipe ↗</a>}
        </div>)}
        {replacingId===m.id && (<div className="card" style={{marginTop:8}}>
          {options.length===0 ? <small className="muted">Loading...</small> : options.map(o => (<button key={o.id} className="button" onClick={()=>replaceMeal(m,o.name)} style={{marginRight:8}}>{o.name}</button>))}
        </div>)}
      </div>
    ))}</div>)
  }
  function BlocksList({ blocks }:{ blocks: WorkoutBlock[] }){
    if(blocks.length===0) return <p className="muted">No workout saved for this day.</p>
    return (<div className="grid">{blocks.map(b=>(<div key={b.id} className="card"><b>{b.type}</b><div style={{marginTop:6}}>{Array.isArray(b.movements)?b.movements.map((mv:any,idx:number)=>(<Movement key={idx} name={mv.name}/>)):null}</div></div>))}</div>)
  }

  return (<div className="grid">
    <details style={{border:'1px dashed rgba(0,0,0,.2)',borderRadius:8,padding:'6px 10px', background:'rgba(0,0,0,.02)'}} open={status==='error'}>
      <summary>Debug</summary>
      <div>Status: <b>{status}</b></div>
      {lastError && <div style={{color:'#b91c1c'}}>Error: {lastError}</div>}
    </details>

    <div className="card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h2 style={{margin:0}}>Diet</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="button" onClick={onGenerateDietToday} disabled={busyDiet}>{busyDiet?'…':'Generate Today'}</button>
          <button className="button" onClick={onGenerateDietWeek} disabled={busyDiet}>{busyDiet?'…':'Generate Week (Mon–Sun)'}</button>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:10}}>
        <label className="checkbox-item"><input type="radio" name="dietview" checked={dietView==='today'} onChange={()=>setDietView('today')} /> Today</label>
        <label className="checkbox-item"><input type="radio" name="dietview" checked={dietView==='week'} onChange={()=>setDietView('week')} /> This week</label>
      </div>
      {dietView==='today' ? (<MealsList meals={todayMeals} />) : (<div className="grid">{weekMeals.map(d=>(<div key={d.date} className="card"><b>{d.date}</b><MealsList meals={d.meals} /></div>))}</div>)}
    </div>

    <div className="card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <h2 style={{margin:0}}>Workout</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="button" onClick={onGenerateWorkoutToday} disabled={busyWorkout}>{busyWorkout?'…':'Generate Today'}</button>
          <button className="button" onClick={onGenerateWorkoutWeek} disabled={busyWorkout}>{busyWorkout?'…':'Generate Week (Mon–Sun)'}</button>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:10}}>
        <label className="checkbox-item"><input type="radio" name="wview" checked={workoutView==='today'} onChange={()=>setWorkoutView('today')} /> Today</label>
        <label className="checkbox-item"><input type="radio" name="wview" checked={workoutView==='week'} onChange={()=>setWorkoutView('week')} /> This week</label>
      </div>
      {workoutView==='today' ? (<BlocksList blocks={todayBlocks} />) : (<div className="grid">{weekBlocks.map(d=>(<div key={d.date} className="card"><b>{d.date}</b><BlocksList blocks={d.blocks} /></div>))}</div>)}
    </div>
  </div>)
}

function Movement({ name }: { name: string }){
  const supabase = createClient()
  const [info, setInfo] = useState<any>(null)
  useEffect(()=>{ supabase.from('exercises').select('*').eq('name', name).maybeSingle().then(({data})=> setInfo(data)) }, [name])
  return (<div className="card" style={{marginTop:6}}><div style={{display:'flex',gap:12,alignItems:'center'}}>{info?.image_url && <img src={info.image_url} alt={name} style={{width:64,height:64,objectFit:'cover',borderRadius:8}} />}<div><div><b>{name}</b></div><small className="muted">{info?.description || 'Guided movement'}</small></div></div></div>)
}
