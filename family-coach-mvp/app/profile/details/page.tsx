'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Profile = {
  full_name?: string | null
  sex?: string | null
  dob?: string | null
  height_cm?: number | null
  current_weight?: number | null
  goal_weight?: number | null
  goal_target_date?: string | null
  activity_level?: string | null
  dietary_pattern?: string | null
  allergies?: string[] | null
  dislikes?: string[] | null
  cuisine_prefs?: string[] | null
  injuries?: string[] | null
  health_conditions?: string[] | null
  equipment?: string[] | null
}

export default function ProfilePage(){
  const supabase = useMemo(()=> createClient(), [])
  const [p, setP] = useState<Profile|null>(null)
  const [msg, setMsg] = useState<string>('')

  useEffect(()=>{ (async()=>{
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user){ setMsg('Please sign in.'); return }
      const sel =
        'full_name, sex, dob, height_cm, current_weight, goal_weight, goal_target_date, activity_level, '+
        'dietary_pattern, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
      const res = await supabase.from('profiles').select(sel).eq('id', user.id).maybeSingle()
      if(res.error){ setMsg(res.error.message); return }
      setP(res.data as Profile)
    }catch(e:any){ setMsg('Failed to load profile') }
  })() }, [supabase])

  if(msg) return <div className="container"><h1 className="text-2xl font-semibold">Your details</h1><div className="muted">{msg}</div></div>
  if(!p) return <div className="container"><h1 className="text-2xl font-semibold">Your details</h1><div className="muted">Loading…</div></div>

  const fmt = (d?:string|null)=> d ? new Date(d).toLocaleDateString() : '—'
  const list = (a?:string[]|null)=> a && a.length ? a.join(', ') : '—'

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Your details</h1>

      <section className="card" style={{display:'grid', gap:8}}>
        <div><b>Name:</b> {p.full_name || '—'}</div>
        <div><b>Sex:</b> {p.sex || '—'}</div>
        <div><b>Date of birth:</b> {fmt(p.dob)}</div>
        <div><b>Height:</b> {p.height_cm ? `${p.height_cm} cm` : '—'}</div>
        <div><b>Current weight:</b> {p.current_weight ?? '—'} {p.current_weight!=null ? 'kg' : ''}</div>
        <div><b>Goal weight:</b> {p.goal_weight ?? '—'} {p.goal_weight!=null ? 'kg' : ''}</div>
        <div><b>Target date:</b> {fmt(p.goal_target_date)}</div>
        <div><b>Activity level:</b> {p.activity_level || '—'}</div>
      </section>

      <section className="card" style={{display:'grid', gap:8}}>
        <div><b>Dietary pattern:</b> {p.dietary_pattern || '—'}</div>
        <div><b>Allergies:</b> {list(p.allergies)}</div>
        <div><b>Dislikes:</b> {list(p.dislikes)}</div>
        <div><b>Cuisine preferences:</b> {list(p.cuisine_prefs)}</div>
      </section>

      <section className="card" style={{display:'grid', gap:8}}>
        <div><b>Injuries:</b> {list(p.injuries)}</div>
        <div><b>Health conditions:</b> {list(p.health_conditions)}</div>
        <div><b>Equipment:</b> {list(p.equipment)}</div>
      </section>
    </div>
  )
}
