'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import styles from './home/home-ui.module.css'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string|null; title?: string|null; details?: string|null }
type CalEvent = { id:string; title:string; date:string; start_time?:string|null; end_time?:string|null }
type GroceryItem = { id:string; name:string; quantity?:number|null; unit?:string|null; done?:boolean|null }
type Profile = { full_name?:string|null; goal_weight?:number|null; target_weight?:number|null; goal_date?:string|null; target_date?:string|null }

const ymd = (d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const today = ymd(new Date())
const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00–09:00', snack: '11:00–12:00', lunch: '13:00–14:00', snack_pm: '16:00–17:00', dinner: '19:00–20:00'
}
const mealLabel = (t?:string)=>{ const v=(t||'').toLowerCase(); if(v.includes('break'))return'Breakfast'; if(v.includes('lunch'))return'Lunch'; if(v.includes('dinner'))return'Dinner'; if(v.includes('snack'))return'Snack'; return'Meal' }
const timeRange = (a?:string|null,b?:string|null)=> (a||b)?`${(a||'').slice(0,5)} - ${(b||'').slice(0,5)}`:''

export default function HomePage(){
  const supabase = useMemo(()=>createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  ), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile|null>(null)
  const [latestWeight, setLatestWeight] = useState<number|null>(null)
  const [eventsByDate, setEventsByDate] = useState<Record<string,CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string,Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string,WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])
  const [authMissing, setAuthMissing] = useState(false)

  function notify(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast){ (window as any).toast(kind,msg) }
  }

  useEffect(()=>{ (async()=>{
    try{
      const { data:{ session } } = await supabase.auth.getSession()
      if(!session){ setAuthMissing(true); setLoading(false); return }

      const res = await fetch('/api/home/summary', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if(!res.ok){
        console.warn('summary api failed', await res.text())
        setLoading(false)
        return
      }
      const json = await res.json()

      setProfile(json.profile || null)
      setLatestWeight(json.latestWeight ?? null)
      setEventsByDate(json.eventsByDate || {})
      setMealsByDate(json.mealsByDate || {})
      setBlocksByDate(json.blocksByDate || {})
      setGrocery(json.grocery || [])
    } catch(e){
      console.warn(e)
      notify('error','Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  })() }, [supabase])

  const greeting = (() => { const h=new Date().getHours(); return h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening' })()
  const useGoalWeight = (profile?.goal_weight ?? profile?.target_weight) ?? null
  const useGoalDate   = (profile?.goal_date   ?? profile?.target_date)   ?? null
  const daysToGo = useGoalDate ? Math.max(0, Math.ceil((+new Date((useGoalDate as string)+'T00:00:00') - +new Date())/86400000)) : null
  const goalDelta = (latestWeight!=null && useGoalWeight!=null)
    ? Math.round((latestWeight - (useGoalWeight as number))*10)/10 : null

  const todayMeals = mealsByDate[today] || []
  const todayBlocks = blocksByDate[today] || []
  const todayEvents = (eventsByDate[today] || []).slice(0,3)

  if (authMissing) {
    return <div className="container" style={{paddingBottom:84}}><div className="muted">Please sign in.</div></div>
  }

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

      {loading ? <div className="muted">Loading…</div> : (
        <>
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
