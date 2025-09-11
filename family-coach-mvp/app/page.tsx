'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabaseClient'
import styles from './home/home-ui.module.css'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string|null; title?: string|null; details?: string|null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }
type CalEvent = { id:string; title:string; date:string; start_time?:string|null; end_time?:string|null }
type GroceryItem = { id:string; name:string; quantity?:number|null; unit?:string|null; done?:boolean|null }
type Profile = { full_name?:string|null; goal_weight?:number|null; target_weight?:number|null; goal_date?:string|null; target_date?:string|null }

const pad = (n:number)=>String(n).padStart(2,'0')
const ymd = (d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const today = ymd(new Date())
const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00', snack: '11:00–12:00', lunch: '13:00–14:00', snack_pm: '16:00–17:00', dinner: '19:00–20:00'
}
const mealLabel = (t?:string)=>{ const v=(t||'').toLowerCase(); if(v.includes('break'))return'Breakfast'; if(v.includes('lunch'))return'Lunch'; if(v.includes('dinner'))return'Dinner'; if(v.includes('snack'))return'Snack'; return'Meal' }
const timeRange = (a?:string|null,b?:string|null)=> (a||b)?`${(a||'').slice(0,5)} - ${(b||'').slice(0,5)}`:''

function mondayOfWeek(d: Date){
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = c.getDay() || 7
  if(day>1) c.setDate(c.getDate()-(day-1))
  return c
}
function weekDatesFrom(d: Date){
  const m = mondayOfWeek(d); const out: string[]=[]
  for(let i=0;i<7;i++){ const dd = new Date(m); dd.setDate(m.getDate()+i); out.push(ymd(dd)) }
  return out
}

export default function HomePage(){
  const supabase = useMemo(()=>createClient(), [])
  const [authChecked, setAuthChecked] = useState(false)
  const [userId, setUserId] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)

  const [profile, setProfile] = useState<Profile|null>(null)
  const [latestWeight, setLatestWeight] = useState<number|null>(null)
  const [eventsByDate, setEventsByDate] = useState<Record<string,CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string,Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string,WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])

  function notify(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast){ (window as any).toast(kind,msg) }
  }

  async function detectEventsTable(): Promise<string|null>{
    const candidates = ['events','calendar_events','family_events','household_events']
    for(const t of candidates){
      const r = await supabase.from(t).select('id').limit(1)
      // If it’s not “relation missing” (42P01), treat as usable (RLS/empty OK)
      if(!r.error || (r.error as any)?.code !== '42P01') return t
    }
    return null
  }

  async function loadAll(uid:string){
    setLoading(true)
    try{
      // PROFILE (supports both goal_* and target_*)
      const prof = await supabase
        .from('profiles')
        .select('full_name, goal_weight, target_weight, goal_date, target_date')
        .eq('id', uid).maybeSingle()
      setProfile((prof.data||null) as Profile)

      // LATEST WEIGHT
      const w = await supabase
        .from('weights').select('kg').eq('user_id', uid)
        .order('date',{ascending:false}).limit(1).maybeSingle()
      setLatestWeight((w.data as any)?.kg ?? null)

      // EVENTS (next 14 days)
      const evTable = await detectEventsTable()
      const evMap: Record<string,CalEvent[]> = {}
      if(evTable){
        const start = today
        const end = ymd(new Date(new Date().setDate(new Date().getDate()+14)))
        const r = await supabase.from(evTable)
          .select('id,title,name,date,start_time,end_time,starts_at,ends_at')
          .gte('date', start).lte('date', end)
        if(!r.error && r.data){
          for(const row of r.data as any[]){
            const d = row.date
            const ev: CalEvent = {
              id: String(row.id),
              title: row.title || row.name || 'Event',
              date: d,
              start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11,16) : null),
              end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11,16) : null),
            }
            ;(evMap[d] ||= []).push(ev)
          }
          Object.values(evMap).forEach(list => list.sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||'')))
        }
      }
      setEventsByDate(evMap)

      // MEALS & WORKOUTS (this week)
      const week = weekDatesFrom(new Date())

      const pds = await supabase.from('plan_days').select('id,date').eq('user_id', uid).in('date', week)
      const pdIds = ((pds.data||[]) as PlanDay[]).map(p=>p.id)
      const meals = pdIds.length ? await supabase.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds) : {data:[]}
      const byMeals: Record<string,Meal[]> = {}; week.forEach(d=>byMeals[d]=[])
      for(const p of (pds.data||[]) as PlanDay[]){ byMeals[p.date] = (meals.data||[] as Meal[]).filter(m=>m.plan_day_id===p.id) }
      setMealsByDate(byMeals)

      const wds = await supabase.from('workout_days').select('id,date').eq('user_id', uid).in('date', week)
      const wdIds = ((wds.data||[]) as WorkoutDay[]).map(w=>w.id)
      const blocks = wdIds.length ? await supabase.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds) : {data:[]}
      const byBlocks: Record<string,WorkoutBlock[]> = {}; week.forEach(d=>byBlocks[d]=[])
      for(const w of (wds.data||[]) as WorkoutDay[]){ byBlocks[w.date] = (blocks.data||[] as WorkoutBlock[]).filter(b=>b.workout_day_id===w.id) }
      setBlocksByDate(byBlocks)

      // GROCERY (support both names)
      let g:any = await supabase.from('grocery_items').select('id,name,quantity,unit,done').eq('user_id', uid).order('name')
      if(g.error){ g = await supabase.from('shopping_items').select('id,name,quantity,unit,done').eq('user_id', uid).order('name') }
      setGrocery((g.data||[]) as GroceryItem[])
    }catch(e){
      console.warn('home load error', e)
      notify('error','Failed to load dashboard')
    }finally{
      setLoading(false)
    }
  }

  // Auth boot using the same SSR browser client your other pages use
  useEffect(()=>{ 
    let unsub: { unsubscribe: ()=>void } | undefined
    ;(async()=>{
      const { data:{ session } } = await supabase.auth.getSession()
      const currUser = session?.user ?? (await supabase.auth.getUser()).data.user ?? null
      if(currUser?.id){
        setUserId(currUser.id)
        await loadAll(currUser.id)
      }
      // pick up late session changes
      unsub = supabase.auth.onAuthStateChange((_event, s)=>{
        const id = s?.user?.id || null
        setUserId(id)
        if(id) loadAll(id)
      }).data?.subscription
      setAuthChecked(true)
    })()
    return ()=>{ try{unsub?.unsubscribe()}catch{} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const greeting = (() => { const h=new Date().getHours(); return h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening' })()
  const useGoalWeight = (profile?.goal_weight ?? profile?.target_weight) ?? null
  const useGoalDate   = (profile?.goal_date   ?? profile?.target_date)   ?? null
  const daysToGo = useGoalDate ? Math.max(0, Math.ceil((+new Date((useGoalDate as string)+'T00:00:00') - +new Date())/86400000)) : null
  const goalDelta = (latestWeight!=null && useGoalWeight!=null)
    ? Math.round((latestWeight - (useGoalWeight as number))*10)/10 : null

  const todayMeals = mealsByDate[today] || []
  const todayBlocks = blocksByDate[today] || []
  const todayEvents = (eventsByDate[today] || []).slice(0,3)

  return (
    <div className="container" style={{display:'grid', gap:16, paddingBottom:84}}>
      <div className={styles.appBrand}>HouseholdHQ</div>
      <h1 className={styles.h1}>{greeting}</h1>

      {!userId && authChecked && (
        <div className="panel" style={{color:'var(--muted)'}}>
          You’re not signed in. Sign in from the header to load your data.
        </div>
      )}

      <section className={`panel ${styles.goalCard}`}>
        <div className={styles.goalRow}><div>Your Goal</div><div className={styles.goalVal}>{useGoalWeight!=null ? `${useGoalWeight} Kg` : '—'}</div></div>
        <div className={styles.goalRow}><div>Target Date</div><div className={styles.goalVal}>{useGoalDate ? new Date((useGoalDate as string)+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '—'}</div></div>
        <div className={styles.goalRow}><div>Days to go</div><div className={styles.goalVal}>{daysToGo!=null ? daysToGo : '—'}</div></div>
        <div className={styles.goalDiff}>{goalDelta!=null ? `${Math.abs(goalDelta)} Kg ${goalDelta>0?'above':'below'} goal` : '—'}</div>
      </section>

      {(loading && userId) ? <div className="muted">Loading…</div> : (
        <>
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
            {todayMeals.length===0 ? <div className="muted">No plan yet.</div> : (
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
            {todayBlocks.length===0 ? <div className="muted">No plan yet.</div> : (
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
        </>
      )}
    </div>
  )
}
