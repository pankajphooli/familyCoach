'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabaseClient'

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
  const router = useRouter()

  const [p, setP] = useState<Profile|null>(null)
  const [msg, setMsg] = useState<string>('Loading…')
  const [loading, setLoading] = useState<boolean>(true)

  // Safe formatters (avoid mobile crashes on invalid dates/values)
  const fmtDate = (d?:string|null) => {
    if(!d) return '—'
    const t = Date.parse(d)
    if(Number.isNaN(t)) return '—'
    try{ return new Date(t).toLocaleDateString() } catch { return '—' }
  }
  const list = (a?:string[]|null) => (Array.isArray(a) && a.length ? a.join(', ') : '—')

  useEffect(()=>{ (async()=>{
    setLoading(true)
    setMsg('Loading…')
    try{
      const { data:{ user }, error: auErr } = await supabase.auth.getUser()
      if(auErr) { setMsg(auErr.message); setLoading(false); return }
      if(!user){ setMsg('Please sign in.'); setLoading(false); return }

      const sel =
        'full_name, sex, dob, height_cm, current_weight, goal_weight, goal_target_date, activity_level, '+
        'dietary_pattern, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
      const res = await supabase.from('profiles').select(sel).eq('id', user.id).maybeSingle()
      if(res.error){ setMsg(res.error.message); setLoading(false); return }

      // If current_weight missing in profile, fall back to latest from weights log
      let prof = (res.data || {}) as Profile
      if(prof.current_weight == null){
        const w = await supabase
          .from('weights')
          .select('weight_kg, date')
          .eq('user_id', user.id)
          .order('date', { ascending:false })
          .limit(1)
          .maybeSingle()
        if(w.data?.weight_kg != null){
          prof = { ...prof, current_weight: Number(w.data.weight_kg) }
        }
      }

      setP(prof)
      setMsg('')
    }catch(e:any){
      console.warn('profile load error', e)
      setMsg('Failed to load your details.')
    }finally{
      setLoading(false)
    }
  })() }, [supabase])

  const onBack = () => {
    try {
      if (window.history.length > 1) router.back()
      else router.push('/')
    } catch {
      router.push('/')
    }
  }
  const onEdit = () => router.push('/onboarding')

  return (
    <div className="container" style={{display:'grid', gap:16}}>
      {/* Header bar with Back + Edit */}
      <div className="flex items-center justify-between" style={{marginTop:4}}>
        <button className="icon-button" onClick={onBack} aria-label="Back">
          {/* chevron-left */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="text-2xl font-semibold">Your details</h1>
        <button className="button" onClick={onEdit}>Edit</button>
      </div>

      {loading && <div className="muted">{msg}</div>}
      {!loading && msg && <div className="banner error">{msg}</div>}

      {!loading && !msg && p && (
        <>
          <section className="card" style={{display:'grid', gap:8}}>
            <div><b>Name:</b> {p.full_name || '—'}</div>
            <div><b>Sex:</b> {p.sex || '—'}</div>
            <div><b>Date of birth:</b> {fmtDate(p.dob)}</div>
            <div><b>Height:</b> {p.height_cm != null ? `${p.height_cm} cm` : '—'}</div>
            <div><b>Current weight:</b> {p.current_weight != null ? `${p.current_weight} kg` : '—'}</div>
            <div><b>Goal weight:</b> {p.goal_weight != null ? `${p.goal_weight} kg` : '—'}</div>
            <div><b>Target date:</b> {fmtDate(p.goal_target_date)}</div>
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
        </>
      )}
    </div>
  )
}
