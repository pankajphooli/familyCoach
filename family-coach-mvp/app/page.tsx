'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import styles from './home/home-ui.module.css'   // <-- fixed import (module)

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }
type CalEvent = { id: string; title: string; date: string; start_time?: string|null; end_time?: string|null }
type GroceryItem = { id: string; name: string; quantity?: number|null; unit?: string|null; done?: boolean|null }

type Profile = {
  full_name?: string|null
  goal_weight?: number|null
  goal_date?: string|null
}

type Tab = 'today' | 'week'

/* ---------- helpers ---------- */
const pad = (n:number)=>String(n).padStart(2,'0')
function ymd(d: Date){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function mondayOfWeek(d: Date){
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = copy.getDay() || 7
  if(day>1) copy.setDate(copy.getDate()-(day-1))
  return copy
}
function weekDatesFrom(d: Date){
  const m = mondayOfWeek(d); const out: string[]=[]
  for(let i=0;i<7;i++){ const dd = new Date(m); dd.setDate(m.getDate()+i); out.push(ymd(dd)) }
  return out
}
const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00',
  snack: '11:00–12:00',
  lunch: '13:00–14:00',
  snack_pm: '16:00–17:00',
  dinner: '19:00–20:00'
}
const mealTag = (mt: string) => {
  const t = (mt||'').toLowerCase()
  if(t.includes('break')) return 'Breakfast'
  if(t.includes('lunch')) return 'Lunch'
  if(t.includes('dinner')) return 'Dinner'
  if(t.includes('snack')) return 'Snack'
  return 'Meal'
}
const timeRange = (a?:string|null,b?:string|null)=> (a||b)?`${(a||'').slice(0,5)} - ${(b||'').slice(0,5)}`:''

/* ---------- component ---------- */
export default function HomePage(){
  const supabase = useMemo(()=>{
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    return createSupabaseClient(url, anon)
  }, [])

  const [tab, setTab] = useState<Tab>('today')
  const [selDay, setSelDay] = useState<string>(ymd(new Date()))
  const [weekDates, setWeekDates] = useState<string[]>(weekDatesFrom(new Date()))

  // profile & goal
  const [profile, setProfile] = useState<Profile|null>(null)
  const [latestWeight, setLatestWeight] = useState<number|null>(null)

  // data
  const [eventsByDate, setEventsByDate] = useState<Record<string,CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string,Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string,WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])

  // weight input
  const [weightInput, setWeightInput] = useState<string>('')

  const today = ymd(new Date())

  function notify(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast){ (window as any).toast(kind,msg) }
    else { (kind==='error'?console.warn:console.log)(msg) }
  }

  useEffect(()=>{ setWeekDates(weekDatesFrom(new Date())) }, [])

  useEffect(()=>{ (async()=>{
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user) return

    // profile + name/goal
    const profSel = 'full_name, goal_weight, goal_date'
    const profRes = await supabase.from('profiles').select(profSel).eq('id', user.id).maybeSingle()
    setProfile((profRes.data||null) as Profile)

    // latest weight (weights table: user_id, date, kg)
    const w = await supabase.from('weights').select('kg').eq('user_id', user.id).order('date',{ascending:false}).limit(1).maybeSingle()
    setLatestWeight((w.data as any)?.kg ?? null)

    // calendar events next 14 days across tolerant table names
    const start = today, end = ymd(new Date(new Date().setDate(new Date().getDate()+14)))
    const evTables = ['events','calendar_events','family_events','household_events']
    const evMap: Record<string,CalEvent[]> = {}
    for(const t of evTables){
      const r = await supabase.from(t).select('*').gte('date',start).lte('date',end)
      if(!r.error && r.data){
        for(const row of r.data as any[]){
          const d = row.date
          const ev: CalEvent = {
            id: String(row.id), title: row.title || row.name || 'Event', date: d,
            start_time: row.start_time || (row.starts_at?String(row.starts_at).slice(11,16):null),
            end_time: row.end_time || (row.ends_at?String(row.ends_at).slice(11,16):null)
          }
          ;(evMap[d] ||= []).push(ev)
        }
      }
    }
    Object.values(evMap).forEach(arr=>arr.sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||'')))
    setEventsByDate(evMap)

    // meals/workouts for this week
    const week = weekDatesFrom(new Date())
    // plan_days / meals
    const pds = await supabase.from('plan_days').select('id,date').eq('user_id', user.id).in('date', week)
    const pdIds = ((pds.data||[]) as PlanDay[]).map(p=>p.id)
    const meals = pdIds.length ? await supabase.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds) : {data:[]}
    const byMeals: Record<string,Meal[]> = {}; week.forEach(d=>byMeals[d]=[])
    for(const pd of (pds.data||[]) as PlanDay[]){ byMeals[pd.date] = (meals.data||[] as Meal[]).filter(m=>m.plan_day_id===pd.id) }
    setMealsByDate(byMeals)

    // workout_days / workout_blocks
    const wds = await supabase.from('workout_days').select('id,date').eq('user_id', user.id).in('date', week)
    const wdIds = ((wds.data||[]) as WorkoutDay[]).map(w=>w.id)
    const blocks = wdIds.length ? await supabase.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds) : {data:[]}
    const byBlocks: Record<string,WorkoutBlock[]> = {}; week.forEach(d=>byBlocks[d]=[])
    for(const wd of (wds.data||[]) as WorkoutDay[]){ byBlocks[wd.date] = (blocks.data||[] as WorkoutBlock[]).filter(b=>b.workout_day_id===wd.id) }
    setBlocksByDate(byBlocks)

    // grocery (current list)
    const gr = await supabase.from('grocery_items').select('id,name,quantity,unit,done').eq('user_id', user.id).order('name')
    setGrocery((gr.data||[]) as GroceryItem[])
  })() }, [supabase])

  /* ---------- quick generators (today only, safe-insert) ---------- */
  async function ensureDietToday(){
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ notify('error','Sign in first'); return }
    const pd = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    let pdId = (pd.data as any)?.id as string|undefined
    if(!pdId){
      const ins = await supabase.from('plan_days').insert({ user_id:user.id, date:today }).select('id').maybeSingle()
      pdId = (ins.data as any)?.id
    }
    if(!pdId){ notify('error','Could not create day'); return }
    const hasMeals = await supabase.from('meals').select('id').eq('plan_day_id', pdId)
    if(!hasMeals.error && (hasMeals.data||[]).length===0){
      const defaults = [
        { meal_type:'breakfast', recipe_name:'Oat Bowl' },
        { meal_type:'lunch',     recipe_name:'Chicken Wrap' },
        { meal_type:'dinner',    recipe_name:'Stir Fry Veg + Tofu' },
      ]
      await supabase.from('meals').insert(defaults.map(m=>({...m, plan_day_id: pdId})))
    }
    notify('success','Diet generated for today')
    const pds = await supabase.from('plan_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
    const pdIds2 = ((pds.data||[]) as PlanDay[]).map(p=>p.id)
    const meals2 = pdIds2.length ? await supabase.from('meals').select('*').in('plan_day_id', pdIds2) : {data:[]}
    const by: Record<string,Meal[]> = {}; weekDates.forEach(d=>by[d]=[])
    for(const p of (pds.data||[]) as PlanDay[]){ by[p.date] = (meals2.data||[] as Meal[]).filter(m=>m.plan_day_id===p.id) }
    setMealsByDate(by)
  }

  async function ensureWorkoutToday(){
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ notify('error','Sign in first'); return }
    const wd = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
    let wdId = (wd.data as any)?.id as string|undefined
    if(!wdId){
      const ins = await supabase.from('workout_days').insert({ user_id:user.id, date:today }).select('id').maybeSingle()
      wdId = (ins.data as any)?.id
    }
    if(!wdId){ notify('error','Could not create workout day'); return }
    const has = await supabase.from('workout_blocks').select('id').eq('workout_day_id', wdId)
    if(!has.error && (has.data||[]).length===0){
      const defs = [
        { kind:'warmup',  title:'Warm-up',           details:'5–8 min easy walk + mobility' },
        { kind:'circuit', title:'Bodyweight Squats', details:'3×12' },
        { kind:'circuit', title:'Push-ups (incline)',details:'3×10' },
        { kind:'circuit', title:'Row (band)',        details:'3×12' },
        { kind:'cooldown',title:'Cooldown',          details:'Stretch 5 min' },
      ]
      await supabase.from('workout_blocks').insert(defs.map(b=>({...b, workout_day_id: wdId})))
    }
    notify('success','Workout generated for today')
    const wds = await supabase.from('workout_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
    const wdIds2 = ((wds.data||[]) as WorkoutDay[]).map(w=>w.id)
    const blocks2 = wdIds2.length ? await supabase.from('workout_blocks').select('*').in('workout_day_id', wdIds2) : {data:[]}
    const by: Record<string,WorkoutBlock[]> = {}; weekDates.forEach(d=>by[d]=[])
    for(const w of (wds.data||[]) as WorkoutDay[]){ by[w.date] = (blocks2.data||[] as WorkoutBlock[]).filter(b=>b.workout_day_id===w.id) }
    setBlocksByDate(by)
  }

  /* ---------- weight logging ---------- */
  async function addWeight(){
    try{
      const kg = parseFloat(weightInput)
      if(!kg || isNaN(kg)){ notify('error','Enter weight in kg'); return }
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user){ notify('error','Sign in first'); return }
      await supabase.from('weights').insert({ user_id:user.id, date: today, kg })
      setWeightInput('')
      setLatestWeight(kg)
      notify('success','Weight logged')
    }catch(e){
      console.warn(e)
      notify('error','Could not save weight')
    }
  }

  /* ---------- computed ---------- */
  const todayMeals = mealsByDate[today] || []
  const todayBlocks = blocksByDate[today] || []
  const todayEvents = (eventsByDate[today] || []).slice(0,3)
  const greeting = (() => {
    const h = new Date().getHours()
    if(h<12) return 'Good Morning'
    if(h<17) return 'Good Afternoon'
    return 'Good Evening'
  })()
  const goalDelta = (latestWeight!=null && profile?.goal_weight!=null)
    ? (Math.round((latestWeight - (profile.goal_weight as number))*10)/10)
    : null
  const daysToGo = profile?.goal_date ? Math.max(0, Math.ceil((+new Date((profile.goal_date as string)+'T00:00:00') - +new Date())/86400000)) : null

  /* ---------- render ---------- */
  return (
    <div className={`container ${styles.home}`} style={{display:'grid', gap:16, paddingBottom:84}}>
      {/* Brand */}
      <div className="text-center">
        <div className={styles.appBrand}>HouseholdHQ</div>
      </div>

      {/* Greeting & Goal card */}
      <h1 className="page-title">{greeting} {profile?.full_name ? profile.full_name : ''}</h1>

      <section className={`panel ${styles.goalCard}`}>
        <div className={styles.goalRow}>
          <div>Your Goal</div>
          <div className={styles.goalVal}>{profile?.goal_weight!=null ? `${profile.goal_weight} Kg` : '—'}</div>
        </div>
        <div className={styles.goalRow}>
          <div>Target Date</div>
          <div className={styles.goalVal}>{profile?.goal_date ? new Date((profile.goal_date as string)+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
        </div>
        <div className={styles.goalRow}>
          <div>Days to go</div>
          <div className={styles.goalVal}>{daysToGo!=null ? daysToGo : '—'}</div>
        </div>
        <div className={styles.goalDiff}>
          {goalDelta!=null ? `${Math.abs(goalDelta)} Kg ${goalDelta>0?'above':'below'} goal` : '—'}
        </div>
      </section>

      {/* Tabs */}
      <div className="chips">
        <button className={`chip ${tab==='today'?'on':''}`} onClick={()=>setTab('today')}>Today</button>
        <button className={`chip ${tab==='week'?'on':''}`} onClick={()=>{ setTab('week'); setSelDay(weekDates[0]) }}>Week</button>
      </div>

      {tab==='today' ? (
        <>
          <div className="muted text-center">Here’s how your today looks like</div>

          {/* Calendar Today */}
          <section className="panel">
            <div className={styles.sectionTitle}>Today’s Calendar</div>
            {todayEvents.length===0 ? <div className="muted">No events.</div> : (
              <ul className={styles.list}>
                {todayEvents.map(ev=>(
                  <li key={ev.id} className={styles.listRow}>
                    <div>{ev.title}</div>
                    <div className={styles.time}>{timeRange(ev.start_time, ev.end_time)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Diet Today */}
          <section className="panel">
            <div className={styles.sectionTitle}>Today’s Diet</div>
            {todayMeals.length===0 ? (
              <>
                <div className="muted">No plan yet.</div>
                <button className="button" onClick={ensureDietToday} style={{marginTop:8}}>Generate</button>
              </>
            ) : (
              <ul className={styles.list}>
                {todayMeals.map(m=>(
                  <li key={m.id} className={styles.listRow}>
                    <div>{mealTag(m.meal_type)}</div>
                    <div className={styles.time}>{MEAL_TIME[m.meal_type] || '—'}</div>
                    <div className="muted" style={{gridColumn:'1 / -1'}}>{m.recipe_name||'TBD'}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Workout Today */}
          <section className="panel">
            <div className={styles.sectionTitle}>Today’s Workout</div>
            {todayBlocks.length===0 ? (
              <>
                <div className="muted">No plan yet.</div>
                <button className="button" onClick={ensureWorkoutToday} style={{marginTop:8}}>Generate</button>
              </>
            ) : (
              <ul className={styles.list}>
                {todayBlocks.map(b=>(
                  <li key={b.id} className={styles.listRow}>
                    <div>{b.title || b.kind || 'Block'}</div>
                    <div className="muted" style={{gridColumn:'1 / -1'}}>{b.details||''}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Grocery snapshot */}
          <section className="panel">
            <div className={styles.sectionTitle}>Your Grocery list</div>
            {grocery.length===0 ? <div className="muted">Empty.</div> : (
              <ul className={styles.list}>
                {grocery.slice(0,6).map(it=>(
                  <li key={it.id} className={styles.listRow}>
                    <div>{it.name}</div>
                    <div className="muted">{it.quantity??''} {it.unit??''}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Log weight */}
          <section className="panel">
            <div className={styles.sectionTitle}>Log weight</div>
            <div className={styles.weightRow}>
              <input className="pill-input" placeholder="Log weight (kg)" inputMode="decimal" value={weightInput} onChange={e=>setWeightInput(e.target.value)} />
              <button className="button" onClick={addWeight}>Add</button>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Week date chips */}
          <div className="chips">
            {weekDates.map(d=>(
              <button key={d} className={`chip ${selDay===d?'on':''}`} onClick={()=>setSelDay(d)}>
                {new Date(d+'T00:00:00').toLocaleDateString(undefined,{weekday:'short', day:'2-digit'})}
              </button>
            ))}
          </div>

          <div className={styles.grid2}>
            {/* Week Calendar */}
            <section className="panel">
              <div className={styles.sectionTitle}>Calendar</div>
              {!(eventsByDate[selDay]||[]).length ? <div className="muted">No events.</div> : (
                <ul className={styles.list}>
                  {(eventsByDate[selDay]||[]).map(ev=>(
                    <li key={ev.id} className={styles.listRow}>
                      <div>{ev.title}</div>
                      <div className={styles.time}>{timeRange(ev.start_time, ev.end_time)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Week Diet */}
            <section className="panel">
              <div className={styles.sectionTitle}>Diet</div>
              {!(mealsByDate[selDay]||[]).length ? <div className="muted">No plan.</div> : (
                <ul className={styles.list}>
                  {(mealsByDate[selDay]||[]).map(m=>(
                    <li key={m.id} className={styles.listRow}>
                      <div>{mealTag(m.meal_type)}</div>
                      <div className="muted" style={{gridColumn:'1 / -1'}}>{m.recipe_name||'TBD'}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Week Exercise */}
            <section className="panel">
              <div className={styles.sectionTitle}>Exercise</div>
              {!(blocksByDate[selDay]||[]).length ? <div className="muted">No plan.</div> : (
                <ul className={styles.list}>
                  {(blocksByDate[selDay]||[]).map(b=>(
                    <li key={b.id} className={styles.listRow}>
                      <div>{b.title || b.kind || 'Block'}</div>
                      <div className="muted" style={{gridColumn:'1 / -1'}}>{b.details||''}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Week Grocery (current list) */}
            <section className="panel">
              <div className={styles.sectionTitle}>Your Grocery list</div>
              {grocery.length===0 ? <div className="muted">Empty.</div> : (
                <ul className={styles.list}>
                  {grocery.slice(0,6).map(it=>(
                    <li key={it.id} className={styles.listRow}>
                      <div>{it.name}</div>
                      <div className="muted">{it.quantity??''} {it.unit??''}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
