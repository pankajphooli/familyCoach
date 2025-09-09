'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }
type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }

type MainTab = 'diet'|'workout'
type SubTab  = 'today'|'week'

const MEAL_TIME: Record<string,string> = {
  breakfast: '08:00 – 09:00',
  snack: '10:30 – 11:00',
  lunch: '12:30 – 13:30',
  snack_pm: '16:00 – 16:30',
  dinner: '18:30 – 19:30',
}

function ymdLocal(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function mondayOfWeek(d: Date){ const dd=new Date(d.getFullYear(), d.getMonth(), d.getDate()); const w=dd.getDay()||7; if(w>1) dd.setDate(dd.getDate()-(w-1)); return dd }
function datesMonToSun(mon: Date){ return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return d }) }

function recipeLink(name?:string|null){ if(!name) return '#'; const q = encodeURIComponent(`${name} recipe`); return `https://www.google.com/search?q=${q}` }

export default function PlansPage(){
  const supabase = useMemo(()=>createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
  ), [])

  const [mainTab, setMainTab] = useState<MainTab>('diet')
  const [dietTab, setDietTab] = useState<SubTab>('week')
  const [workTab, setWorkTab] = useState<SubTab>('week')

  const todayStr = useMemo(()=> ymdLocal(new Date()), [])
  const monday = useMemo(()=> mondayOfWeek(new Date()), [])
  const weekDates = useMemo(()=> datesMonToSun(monday).map(ymdLocal), [monday])

  const [selectedDate, setSelectedDate] = useState<string>(todayStr)

  const [byDateMeals, setByDateMeals] = useState<Record<string, Meal[]>>({})
  const [byDateBlocks, setByDateBlocks] = useState<Record<string, WorkoutBlock[]>>({})
  const [needsAuth, setNeedsAuth] = useState(false)
  const [busy, setBusy] = useState(false)

  // -------- auth + boot ----------
  async function userId(): Promise<string|null>{
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id ?? null
  }

  async function ensureWeek(uid:string){
    // ensure plan/workout entities exist for this week
    for(const d of weekDates){
      // plan days
      const pd = await supabase.from('plan_days').select('id').eq('user_id', uid).eq('date', d).maybeSingle()
      let pdId = (pd.data as any)?.id
      if(!pdId){
        const ins = await supabase.from('plan_days').insert({ user_id: uid, date: d }).select('id').single()
        pdId = (ins.data as any).id
        // add defaults
        await supabase.from('meals').insert([
          { plan_day_id: pdId, meal_type:'breakfast', recipe_name:'Oat Bowl' },
          { plan_day_id: pdId, meal_type:'lunch',     recipe_name:'Chicken Wrap' },
          { plan_day_id: pdId, meal_type:'dinner',    recipe_name:'Veg Stir Fry' },
        ])
      }

      // workout days
      const wd = await supabase.from('workout_days').select('id').eq('user_id', uid).eq('date', d).maybeSingle()
      let wdId = (wd.data as any)?.id
      if(!wdId){
        const ins = await supabase.from('workout_days').insert({ user_id: uid, date: d }).select('id').single()
        wdId = (ins.data as any).id
        await supabase.from('workout_blocks').insert([
          { workout_day_id: wdId, kind:'warmup',  title:'Warm-up',  details:'Walk 5–8 min' },
          { workout_day_id: wdId, kind:'circuit', title:'Glute bridge', details:'3×12' },
          { workout_day_id: wdId, kind:'circuit', title:'Row (band)', details:'3×12' },
          { workout_day_id: wdId, kind:'circuit', title:'Plank', details:'3×30s' },
          { workout_day_id: wdId, kind:'cooldown', title:'Cooldown', details:'Stretch 5 min' },
        ])
      }
    }
  }

  async function loadWeek(uid:string){
    const [pdRes, wdRes] = await Promise.all([
      supabase.from('plan_days').select('id,date').eq('user_id', uid).in('date', weekDates),
      supabase.from('workout_days').select('id,date').eq('user_id', uid).in('date', weekDates),
    ])
    const pds = (pdRes.data||[]) as PlanDay[]
    const wds = (wdRes.data||[]) as WorkoutDay[]

    const mealRes = pds.length ? await supabase.from('meals').select('*').in('plan_day_id', pds.map(p=>p.id)) : { data: [] as any[] }
    const blockRes = wds.length ? await supabase.from('workout_blocks').select('*').in('workout_day_id', wds.map(w=>w.id)) : { data: [] as any[] }

    const meals = (mealRes.data||[]) as Meal[]
    const blocks = (blockRes.data||[]) as WorkoutBlock[]

    const mealsBy: Record<string, Meal[]> = {}; weekDates.forEach(d=> mealsBy[d]=[])
    const blocksBy: Record<string, WorkoutBlock[]> = {}; weekDates.forEach(d=> blocksBy[d]=[])

    for(const pd of pds){ mealsBy[pd.date] = meals.filter(m=>m.plan_day_id===pd.id) }
    for(const wd of wds){ blocksBy[wd.date] = blocks.filter(b=>b.workout_day_id===wd.id) }

    setByDateMeals(mealsBy); setByDateBlocks(blocksBy)
  }

  useEffect(()=>{
    (async()=>{
      setBusy(true)
      const uid = await userId()
      if(!uid){ setNeedsAuth(true); setBusy(false); return }
      await ensureWeek(uid)
      await loadWeek(uid)
      setNeedsAuth(false); setBusy(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------- UI helpers ----------
  function Seg({left, right, value, onChange}:{left:string; right:string; value:'left'|'right'; onChange:(v:'left'|'right')=>void}){
    return (
      <div className="rounded-full border p-1 bg-muted/30" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:2}}>
        <button className="rounded-full px-4 py-2 text-sm" onClick={()=>onChange('left')} style={{background:value==='left'?'var(--foreground, #111)':'transparent', color:value==='left'?'#fff':'inherit'}}> {left} </button>
        <button className="rounded-full px-4 py-2 text-sm" onClick={()=>onChange('right')} style={{background:value==='right'?'var(--foreground, #111)':'transparent', color:value==='right'?'#fff':'inherit'}}> {right} </button>
      </div>
    )
  }

  function SubTabs({value, onChange}:{value:SubTab; onChange:(v:SubTab)=>void}){
    return (
      <div className="flex items-center gap-6 px-1">
        <button className="text-base" style={{opacity:value==='today'?1:.6}} onClick={()=>onChange('today')}>Today</button>
        <button className="text-base" style={{opacity:value==='week'?1:.6, position:'relative'}} onClick={()=>onChange('week')}>
          Week
          {value==='week' && <span style={{position:'absolute', left:0, right:0, bottom:-6, height:2, background:'currentColor', opacity:.9}}/>}
        </button>
      </div>
    )
  }

  function DatePills({dates, value, onChange}:{dates:string[]; value:string; onChange:(d:string)=>void}){
    return (
      <div style={{display:'flex', gap:10, overflowX:'auto', padding:'8px 2px'}}>
        {dates.map(d=>{
          const active = value===d
          return (
            <button key={d} onClick={()=>onChange(d)} className="px-4 py-2 rounded-full border"
              style={{whiteSpace:'nowrap', background: active?'var(--foreground, #111)':'transparent', color: active?'#fff':'inherit'}}>
              {d}
            </button>
          )
        })}
      </div>
    )
  }

  // -------- actions ----------
  async function addToGrocery(recipeName:string|null){
    if(!recipeName) return
    const { data: rec } = await supabase.from('recipes').select('ingredients').ilike('name', recipeName).maybeSingle()
    const list: string[] = (rec as any)?.ingredients || []
    if(!list.length){ if(typeof window!=='undefined') (window as any).toast?.('error','No structured ingredients'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ (window as any).toast?.('error','Sign in'); return }
    // add each as single row; increment quantity if exists
    const counts: Record<string, number> = {}
    for(const raw of list){ const name = String(raw).trim().toLowerCase(); counts[name]=(counts[name]||0)+1 }
    for(const [name, qty] of Object.entries(counts)){
      const ex = await supabase.from('grocery_items').select('id,quantity').eq('user_id', user.id).eq('name', name).maybeSingle()
      if(ex.data){
        const cur = (ex.data as any).quantity ?? 1
        await supabase.from('grocery_items').update({ quantity: cur + (qty as number) }).eq('id', (ex.data as any).id)
      }else{
        await supabase.from('grocery_items').insert({ user_id: user.id, name, quantity: qty, done:false })
      }
    }
    (window as any).toast?.('success','Added to grocery')
  }

  // -------- render blocks ----------
  const mealsToday = byDateMeals[selectedDate] || []
  const blocksToday = byDateBlocks[selectedDate] || []

  return (
    <div className="container" style={{paddingBottom:80, display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Plans</h1>

      {needsAuth && <div className="card">Please sign in.</div>}

      <div className="flex items-center gap-3">
        <Seg left="Diet" right="Exercise" value={mainTab==='diet'?'left':'right'} onChange={(v)=>setMainTab(v==='left'?'diet':'workout')} />
      </div>

      <SubTabs value={mainTab==='diet'?dietTab:workTab} onChange={(v)=> mainTab==='diet'?setDietTab(v):setWorkTab(v)} />

      {(mainTab==='diet'?dietTab:workTab)==='week' && (
        <DatePills dates={weekDates} value={selectedDate} onChange={setSelectedDate} />
      )}

      {mainTab==='diet' && (
        <div className="grid gap-4">
          {mealsToday.length===0 && <div className="muted">No meals.</div>}
          {mealsToday.map(m => (
            <div key={m.id} className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-lg">{m.meal_type || 'Meal'}</div>
                <div className="opacity-70">{m.recipe_name || 'TBD'}</div>
              </div>
              <div className="text-sm opacity-80">{MEAL_TIME[m.meal_type] || '—'}</div>
              <div className="flex items-center gap-2 ml-4">
                <button className="button-outline" onClick={()=> (window as any).open(recipeLink(m.recipe_name),'_blank') }>Recipe</button>
                <button className="button-outline" onClick={()=> addToGrocery(m.recipe_name)}>Add to Grocery</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {mainTab==='workout' && (
        <div className="grid gap-4">
          {blocksToday.length===0 && <div className="muted">No workout.</div>}
          {blocksToday.map(b => (
            <div key={b.id} className="flex items-center justify-between border-b pb-3">
              <div className="text-lg">{b.title || b.kind || 'Block'}</div>
              <div className="opacity-80">{b.details || ''}</div>
            </div>
          ))}
        </div>
      )}

      {busy && <div className="muted">Loading…</div>}
    </div>
  )
}
