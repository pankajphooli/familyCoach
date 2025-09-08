'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }

export default function ChatCoach(){
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<{ role: 'user'|'assistant', content: string }[]>([])
  const [busy, setBusy] = useState(false)

  async function snapshot() {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return { profile: null, week: {} }
    const profSel = 'dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, health_conditions, injuries, equipment'
    const { data: profile } = await supabase.from('profiles').select(profSel).eq('id', user.id).maybeSingle()

    const today = new Date()
    const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const dow = mon.getDay() || 7
    if(dow>1) mon.setDate(mon.getDate()-(dow-1))
    const ymd = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const days = [...Array(7)].map((_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return ymd(d) })

    const { data: pds } = await supabase.from('plan_days').select('id,date').eq('user_id', user.id).in('date', days)
    const mealsByDate: any = {}
    for(const pd of (pds||[])){
      const { data: ms } = await supabase.from('meals').select('meal_type, recipe_name').eq('plan_day_id', (pd as any).id)
      mealsByDate[(pd as any).date] = ms || []
    }

    const { data: wds } = await supabase.from('workout_days').select('id,date').eq('user_id', user.id).in('date', days)
    const blocksByDate: any = {}
    for(const wd of (wds||[])){
      const { data: bs } = await supabase.from('workout_blocks').select('kind,title,details').eq('workout_day_id', (wd as any).id)
      blocksByDate[(wd as any).date] = bs || []
    }

    return { profile, week: { mealsByDate, blocksByDate } }
  }

  async function onSend(){
    if(!input.trim()) return
    const userMsg = input.trim()
    setMessages(m=>[...m, { role: 'user', content: userMsg }])
    setInput('')
    setBusy(true)
    try{
      const ctx = await snapshot()
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, profile: ctx.profile, week: ctx.week })
      })
      const data = await res.json()
      const reply = data?.reply || 'OK.'
      setMessages(m=>[...m, { role: 'assistant', content: reply }])

      const actions = data?.actions || {}
      await apply(actions)
    }finally{
      setBusy(false)
    }
  }

  async function apply(actions:any){
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const run = async ()=>{
      if(actions.replaceMeals && Array.isArray(actions.replaceMeals)){
        for(const r of actions.replaceMeals){
          const { data: pd } = await supabase.from('plan_days').select('id').eq('user_id', user.id).eq('date', r.date).maybeSingle()
          if(pd){
            const { data: ms } = await supabase.from('meals').select('id').eq('plan_day_id', (pd as any).id).eq('meal_type', r.meal_type).maybeSingle()
            if(ms){ await supabase.from('meals').update({ recipe_name: r.recipe_name }).eq('id', (ms as any).id) }
          }
        }
      }
      if(actions.addGrocery && Array.isArray(actions.addGrocery) && actions.addGrocery.length){
        const rows = actions.addGrocery.map((name:string)=>({ user_id: user.id, name, done:false }))
        let ins = await supabase.from('grocery_items').insert(rows)
        if(ins.error){ await supabase.from('shopping_items').insert(rows) }
      }
      if(actions.updateWorkouts && Array.isArray(actions.updateWorkouts)){
        for(const upd of actions.updateWorkouts){
          const { data: wd } = await supabase.from('workout_days').select('id').eq('user_id', user.id).eq('date', upd.date).maybeSingle()
          if(wd){
            await supabase.from('workout_blocks').delete().eq('workout_day_id', (wd as any).id)
            const rows = (upd.blocks||[]).map((b:any)=>({ ...b, workout_day_id: (wd as any).id }))
            if(rows.length) await supabase.from('workout_blocks').insert(rows)
          }
        }
      }
    }
    await run()
  }

  return (
    <div style={{position:'fixed', right:16, bottom:16, zIndex:50}}>
      {open ? (
        <div className="card" style={{width:360, maxHeight:520, display:'grid', gridTemplateRows:'auto 1fr auto', gap:8}}>
          <div className="flex items-center justify-between">
            <div className="font-medium">Coach</div>
            <button className="icon-button" onClick={()=>setOpen(false)}>✕</button>
          </div>
          <div className="grid gap-2 overflow-auto" style={{maxHeight:380, paddingRight:4}}>
            {messages.length===0 && <div className="muted">Ask for swaps, lower salt, chicken-only meals, knee-friendly workouts, etc.</div>}
            {messages.map((m,i)=>(
              <div key={i} className={m.role==='user' ? 'self-end' : 'self-start'}>
                <div className="card" style={{background: m.role==='user' ? 'var(--btn-bg)' : 'var(--card-bg)'}}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && <div className="muted">Thinking…</div>}
          </div>
          <div className="flex gap-2">
            <input className="input flex-1" value={input} onChange={e=>setInput(e.target.value)} placeholder="e.g. No beef; knee pain today" />
            <button className="button" onClick={onSend} disabled={busy}>Send</button>
          </div>
        </div>
      ) : (
        <button className="button" onClick={()=>setOpen(true)}>Open coach</button>
      )}
    </div>
  )
}
