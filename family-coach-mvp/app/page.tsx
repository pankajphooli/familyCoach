'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type Meal = { id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; title?: string | null; kind?: string | null; details?: string | null }
type Event = { id: string; title?: string|null; start_time?: string|null; end_time?: string|null; date?: string|null }
type GroceryItem = { id: string; name: string; quantity?: number|null; done?: boolean|null }

function ymdLocal(d: Date){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
function nextNDatesFromToday(n:number){
  const s=new Date(), out:string[]=[]
  for(let i=0;i<n;i++){ const d=new Date(s); d.setDate(s.getDate()+i); out.push(ymdLocal(d)) }
  return out
}
function labelFor(dstr:string){
  const d = new Date(dstr)
  const today = ymdLocal(new Date())
  if(dstr===today) return 'Today'
  return d.toLocaleDateString(undefined, { weekday:'short', day:'2-digit' })
}

// Simple inline date scroller that reuses your .chips/.chip styles
function DateScrollerInline({ selected, onSelect, days=7 }:{ selected:string; onSelect:(d:string)=>void; days?:number }){
  const dates = useMemo(()=> nextNDatesFromToday(days), [days])
  return (
    <div className="chips" style={{margin:'6px 0 10px'}}>
      {dates.map(d=>(
        <button key={d} className={`chip ${selected===d?'on':''}`} onClick={()=>onSelect(d)}>
          {labelFor(d)}
        </button>
      ))}
    </div>
  )
}

export default function HomePage(){
  const supabase = useMemo(()=>createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  ), [])

  const [selectedDate, setSelectedDate] = useState(ymdLocal(new Date()))
  const [signedIn, setSignedIn] = useState<boolean>(true)
  const [busy, setBusy] = useState(false)

  const [meals, setMeals] = useState<Meal[]>([])
  const [blocks, setBlocks] = useState<WorkoutBlock[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [grocery, setGrocery] = useState<GroceryItem[]>([])
  const [goalWeight, setGoalWeight] = useState<number|null>(null)
  const [targetDate, setTargetDate] = useState<string|null>(null)
  const [currentWeight, setCurrentWeight] = useState<number|null>(null)

  function notify(kind:'error'|'success', msg:string){
    const t = (typeof window!=='undefined' && (window as any).toast) || null
    t ? (window as any).toast(kind,msg) : (kind==='error'?console.warn(msg):console.log(msg))
  }

  // Load all widgets for the selected day
  useEffect(()=>{ (async()=>{
    setBusy(true)
    try{
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user || null
      if(!user){ setSignedIn(false); setMeals([]); setBlocks([]); setEvents([]); setGrocery([]); return }
      setSignedIn(true)

      // ---- profile goals + latest weight (best-effort, tolerant of missing cols) ----
      const profSel = 'goal_weight, target_date'
      const prof = await supabase.from('profiles').select(profSel).eq('id', user.id).maybeSingle()
      if(!prof.error){
        setGoalWeight((prof.data as any)?.goal_weight ?? null)
        setTargetDate((prof.data as any)?.target_date ?? null)
      }

      const wres = await supabase.from('weights').select('weight, date').eq('user_id', user.id).order('date', { ascending:false }).limit(1)
      if(!wres.error && (wres.data||[]).length){ setCurrentWeight((wres.data as any)[0]?.weight ?? null) }

      // ---- meals for selected day ----
      const pd = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', selectedDate).maybeSingle()
      if(pd.data?.id){
        const ml = await supabase.from('meals').select('id, meal_type, recipe_name').eq('plan_day_id', pd.data.id)
        setMeals(ml.data as Meal[] || [])
      } else { setMeals([]) }

      // ---- workouts for selected day ----
      const wd = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', selectedDate).maybeSingle()
      if(wd.data?.id){
        const wb = await supabase.from('workout_blocks').select('id, title, kind, details').eq('workout_day_id', wd.data.id)
        setBlocks(wb.data as WorkoutBlock[] || [])
      } else { setBlocks([]) }

      // ---- events for selected day (created-by; if you store attendees array, extend as needed) ----
      const ev = await supabase.from('events').select('id,title,start_time,end_time,date').eq('user_id', user.id).eq('date', selectedDate).order('start_time', { ascending:true })
      if(!ev.error) setEvents(ev.data as Event[] || [])
      else setEvents([])

      // ---- grocery preview (first 6 unchecked items) with fallback to shopping_items ----
      const gi = await supabase.from('grocery_items').select('id,name,quantity,done').eq('user_id', user.id).eq('done', false).order('created_at', { ascending:false }).limit(6)
      if(!gi.error){
        setGrocery((gi.data as GroceryItem[]) || [])
      }else{
        const si = await supabase.from('shopping_items').select('id,name,quantity,done').eq('user_id', user.id).eq('done', false).order('created_at', { ascending:false }).limit(6)
        setGrocery((si.data as GroceryItem[]) || [])
      }
    }catch(e){
      notify('error','Failed to load home data')
    }finally{
      setBusy(false)
    }
  })() }, [selectedDate, supabase])

  const goalDiff = useMemo(()=>{
    if(goalWeight==null || currentWeight==null) return null
    const diff = Number((currentWeight - goalWeight).toFixed(1))
    return diff
  }, [goalWeight, currentWeight])

  return (
    <div className="container" style={{display:'grid', gap:16, paddingBottom:84}}>
      <h1 className="page-title">Home</h1>

      {/* rolling date scroller (today + next 6) */}
      <DateScrollerInline selected={selectedDate} onSelect={setSelectedDate} />

      {!signedIn && (
        <div className="panel" style={{borderColor:'#e1a', color:'#e11'}}>
          You’re not signed in. Sign in from the header to load your data.
        </div>
      )}

      {/* Goal widget */}
      <section className="panel">
        <div className="form-title">Your goal</div>
        {goalWeight==null && targetDate==null ? (
          <div className="muted">Set a goal in Profile to track progress.</div>
        ) : (
          <div style={{display:'grid', rowGap:6}}>
            <div><strong>Target weight:</strong> {goalWeight ?? '—'}</div>
            <div><strong>Target date:</strong> {targetDate ? new Date(targetDate).toLocaleDateString() : '—'}</div>
            <div><strong>Latest weight:</strong> {currentWeight ?? '—'}</div>
            {goalDiff!=null && (
              <div style={{fontWeight:700}}>
                {goalDiff > 0 ? `${Math.abs(goalDiff)} kg to lose` : goalDiff < 0 ? `${Math.abs(goalDiff)} kg to gain` : 'On target 🎯'}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Today’s Diet (for selected day) */}
      <section className="panel">
        <div className="form-title">Diet — {new Date(selectedDate).toLocaleDateString(undefined,{ weekday:'short', day:'2-digit', month:'short' })}</div>
        {meals.length===0 ? (
          <div className="muted">No meals planned for this day.</div>
        ) : (
          <ul className="grid" style={{gap:10}}>
            {meals.map(m=>(
              <li key={m.id} className="row" style={{display:'grid', gap:6}}>
                <div style={{display:'flex', justifyContent:'space-between', fontWeight:700}}>
                  <span style={{textTransform:'capitalize'}}>{m.meal_type || 'Meal'}</span>
                </div>
                <div>{m.recipe_name || 'TBD'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Today’s Workout (for selected day) */}
      <section className="panel">
        <div className="form-title">Workout — {new Date(selectedDate).toLocaleDateString(undefined,{ weekday:'short', day:'2-digit', month:'short' })}</div>
        {blocks.length===0 ? (
          <div className="muted">No workout planned for this day.</div>
        ) : (
          <ul className="grid" style={{gap:10}}>
            {blocks.map(b=>(
              <li key={b.id} className="row" style={{display:'grid', gap:4}}>
                <div style={{fontWeight:800}}>{b.title || b.kind || 'Block'}</div>
                <div style={{opacity:.85}}>{b.details || '—'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Events for selected day */}
      <section className="panel">
        <div className="form-title">Events — {new Date(selectedDate).toLocaleDateString(undefined,{ weekday:'short', day:'2-digit', month:'short' })}</div>
        {events.length===0 ? (
          <div className="muted">No events for this day.</div>
        ) : (
          <ul className="grid" style={{gap:10}}>
            {events.map(ev=>(
              <li key={ev.id} className="ev-row">
                <div className="ev-title">{ev.title || 'Event'}</div>
                <div className="ev-time">
                  {ev.start_time ? ev.start_time.slice(0,5) : '—'}{ev.end_time ? `–${ev.end_time.slice(0,5)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Grocery preview */}
      <section className="panel">
        <div className="form-title">Grocery (next items)</div>
        {grocery.length===0 ? (
          <div className="muted">No pending items.</div>
        ) : (
          <ul className="grid" style={{gap:8}}>
            {grocery.map(g=>(
              <li key={g.id} className="row" style={{display:'flex', justifyContent:'space-between'}}>
                <span>• {g.name}</span>
                <span style={{opacity:.7}}>{g.quantity ?? 1}×</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {busy && <div className="muted">Refreshing…</div>}
    </div>
  )
}
