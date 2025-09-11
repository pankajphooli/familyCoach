'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import styles from './home/home-ui.module.css'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string|null; title?: string|null; details?: string|null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }
type CalEvent = { id: string; title: string; date: string; start_time?: string|null; end_time?: string|null }
type GroceryItem = { id: string; name: string; quantity?: number|null; unit?: string|null; done?: boolean|null }

type Profile = {
  full_name?: string|null
  goal_weight?: number|null
  target_weight?: number|null
  goal_date?: string|null
  target_date?: string|null
}

type Tab = 'today' | 'week'

/* ---------- small helpers ---------- */
const pad = (n:number)=>String(n).padStart(2,'0')
const ymd = (d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const today = ymd(new Date())
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
const mealLabel = (t?:string)=> {
  const v=(t||'').toLowerCase()
  if(v.includes('break')) return 'Breakfast'
  if(v.includes('lunch')) return 'Lunch'
  if(v.includes('dinner')) return 'Dinner'
  if(v.includes('snack')) return 'Snack'
  return 'Meal'
}
const timeRange = (a?:string|null,b?:string|null)=> (a||b)?`${(a||'').slice(0,5)} - ${(b||'').slice(0,5)}`:''

export default function HomePage(){
  const supabase = useMemo(()=>createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  ), [])

  const [tab, setTab] = useState<Tab>('today')
  const [selDay, setSelDay] = useState<string>(today)
  const [weekDates, setWeekDates] = useState<string[]>(weekDatesFrom(new Date()))

  // data
  const [profile, setProfile] = useState<Profile|null>(null)
  const [latestWeight, setLatestWeight] = useState<number|null>(null)
  const [eventsByDate, setEventsByDate] = useState<Record<string,CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string,Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string,WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])
  const [weightInput, setWeightInput] = useState('')

  function notify(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast){ (window as any).toast(kind,msg) }
    else { (kind==='error'?console.warn:console.log)(msg) }
  }

  /* ---------- flexible loaders that tolerate schema differences ---------- */
  async function detectTable(candidates: string[], selectCols='id'): Promise<string|null>{
    for(const t of candidates){
      const r = await supabase.from(t).select(selectCols).limit(1)
      if(!r.error) return t
      if(r.error?.code !== '42P01'){ /* table exists but another error (e.g. RLS) */ return t }
    }
    return null
  }

  useEffect(()=>{ (async()=>{
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user) return

    /* Profile (support goal_* and target_* names) */
    {
      const r = await supabase
        .from('profiles')
        .select('full_name, goal_weight, target_weight, goal_date, target_date')
        .eq('id', user.id).maybeSingle()
      setProfile((r.data||null) as Profile)

      const w = await supabase
        .from('weights').select('kg').eq('user_id', user.id)
        .order('date',{ascending:false}).limit(1).maybeSingle()
      setLatestWeight((w.data as any)?.kg ?? null)
    }

    /* Events (auto-detect table name) */
    {
      const eventsTable = await detectTable(['events','calendar_events','family_events','household_events'], 'id')
      const start = today
      const end = ymd(new Date(new Date().setDate(new Date().getDate()+14)))
      const by: Record<string,CalEvent[]> = {}

      if(eventsTable){
        const r = await supabase.from(eventsTable)
          .select('id,title,date,start_time,end_time,name,starts_at,ends_at')
          .gte('date', start).lte('date', end)
        if(!r.error && r.data){
          for(const row of r.data as any[]){
            const d = row.date
            const ev: CalEvent = {
              id: String(row.id),
              title: row.title || row.name || 'Event',
              date: d,
              start_time: row.start_time || (row.starts_at?String(row.starts_at).slice(11,16):null),
              end_time: row.end_time || (row.ends_at?String(row.ends_at).slice(11,16):null),
            }
            ;(by[d] ||= []).push(ev)
          }
          Object.values(by).forEach(list => list.sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||'')))
        } else {
          console.warn('Events query error/table RLS', r.error)
        }
      } else {
        console.warn('No events table detected')
      }
      setEventsByDate(by)
    }

    /* Meals this week */
    {
      const pds = await supabase.from('plan_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
      const pdIds = ((pds.data||[]) as PlanDay[]).map(p=>p.id)
      const meals = pdIds.length ? await supabase.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds) : {data:[]}
      const by: Record<string,Meal[]> = {}; weekDates.forEach(d=>by[d]=[])
      for(const p of (pds.data||[]) as PlanDay[]){ by[p.date] = (meals.data||[] as Meal[]).filter(m=>m.plan_day_id===p.id) }
      setMealsByDate(by)
    }

    /* Workouts this week */
    {
      const wds = await supabase.from('workout_days').select('id,date').eq('user_id', user.id).in('date', weekDates)
      const wdIds = ((wds.data||[]) as WorkoutDay[]).map(w=>w.id)
      const blocks = wdIds.length ? await supabase.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds) : {data:[]}
      const by: Record<string,WorkoutBlock[]> = {}; weekDates.forEach(d=>by[d]=[])
      for(const w of (wds.data||[]) as WorkoutDay[]){ by[w.date] = (blocks.data||[] as WorkoutBlock[]).filter(b=>b.workout_day_id===w.id) }
      setBlocksByDate(by)
    }

    /* Grocery (support older table name) */
    {
      const gTable = await detectTable(['grocery_items','shopping_items'],'id')
      if(gTable){
        const g = await supabase.from(gTable).select('id,name,quantity,unit,done').eq('user_id', user.id).order('name')
        setGrocery((g.data||[]) as GroceryItem[])
      }
    }
  })() }, [supabase])

  /* ---------- computed for display ---------- */
  const greeting = (() => { const h=new Date().getHours(); return h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening' })()
  const useGoalWeight = (profile?.goal_weight ?? profile?.target_weight) ?? null
  const useGoalDate   = (profile?.goal_date   ?? profile?.target_date)   ?? null
  const daysToGo = useGoalDate ? Math.max(0, Math.ceil((+new Date((useGoalDate as string)+'T00:00:00') - +new Date())/86400000)) : null
  const goalDelta = (latestWeight!=null && useGoalWeight!=null)
    ? Math.round((latestWeight - (useGoalWeight as number))*10)/10 : null

  const todayMeals = mealsByDate[today] || []
  const todayBlocks = blocksByDate[today] || []
  const todayEvents = (eventsByDate[today] || []).slice(0,3)

  /* ---------- UI (kept minimal; focus is data) ---------- */
  return (
    <div className="container" style={{display:'grid', gap:16, paddingBottom:84}}>
      <div className={styles.appBrand}>HouseholdHQ</div>
      <h1 className={styles.h1}>{greeting}</h1>

      <section className={`panel ${styles.goalCard}`}>
        <div className={styles.goalRow}><div>Your Goal</div><div className={styles.goalVal}>{useGoalWeight!=null ? `${useGoalWeight} Kg` : '—'}</div></div>
        <div className={styles.goalRow}><div>Target Date</div><div className={styles.goalVal}>{useGoalDate ? new Date((useGoalDate as string)+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '—'}</div></div>
        <div className={styles.goalRow}><div>Days to go</div><div className={styles.goalVal}>{daysToGo!=null ? daysToGo : '—'}</div></div>
        <div className={styles.goalDiff}>{goalDelta!=null ? `${Math.abs(goalDelta)} Kg ${goalDelta>0?'above':'below'} goal` : '—'}</div>
      </section>

      <div className={styles.seg}>
        <button className={`${styles.segBtn} ${'active'}`}>Today</button>
        <button className={styles.segBtn} onClick={()=>setTab('week')}>Week</button>
      </div>

      {/* Today’s Calendar */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Calendar</div>
        {todayEvents.length===0 ? <div className="muted">No events.</div> : (
          <ul className={styles.list}>
            {todayEvents.map(ev=>(
              <li key={ev.id} className={styles.row}>
                <div>{ev.title}</div>
                <div className={styles.time}>{timeRange(ev.start_time, ev.end_time)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Today’s Diet */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Diet</div>
        {todayMeals.length===0 ? <div className="muted">No plan yet (generate on Plans page).</div> : (
          <ul className={styles.list}>
            {todayMeals.map(m=>(
              <li key={m.id} className={styles.row}>
                <div>{mealLabel(m.meal_type)}</div>
                <div className={styles.time}>{MEAL_TIME[m.meal_type] || '—'}</div>
                <div className="muted" style={{gridColumn:'1 / -1'}}>{m.recipe_name||'TBD'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Today’s Exercise */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Exercise</div>
        {todayBlocks.length===0 ? <div className="muted">No plan yet (generate on Plans page).</div> : (
          <ul className={styles.list}>
            {todayBlocks.map(b=>(
              <li key={b.id} className={styles.row}>
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
              <li key={it.id} className={styles.row}>
                <div>{it.name}</div>
                <div className="muted">{it.quantity??''} {it.unit??''}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
