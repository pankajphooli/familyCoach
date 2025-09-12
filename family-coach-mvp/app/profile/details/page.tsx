'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../../lib/supabaseClient'

type ProfileRec = Record<string, any>

function arrish(v:any){
  if(!v) return ''
  if(Array.isArray(v)) return v.join(', ')
  return String(v)
}

function Row({label, value}:{label:string; value:any}){
  return (
    <div className="row" style={{display:'grid', gridTemplateColumns:'160px 1fr', gap:8, alignItems:'baseline'}}>
      <div style={{fontWeight:700, opacity:.8}}>{label}</div>
      <div>{value ?? '—'}</div>
    </div>
  )
}

export default function ProfileDetailsPage(){
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRec|null>(null)

  useEffect(()=>{ (async()=>{
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ setLoading(false); return }
    // Pull everything; we’ll render only what exists
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if(!error) setProfile(data as ProfileRec)
    setLoading(false)
  })() }, [supabase])

  return (
    <div className="container" style={{paddingBottom:80, display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Your details</h1>

      {loading ? (
        <div className="panel">Loading…</div>
      ) : !profile ? (
        <div className="panel">
          No profile found. <Link className="link" href="/onboarding">Complete onboarding</Link>.
        </div>
      ) : (
        <div className="card" style={{display:'grid', gap:10}}>
          <Row label="Full name" value={profile.full_name} />
          <Row label="Sex" value={profile.sex} />
          <Row label="Date of birth" value={profile.dob ? new Date(profile.dob).toLocaleDateString() : null} />
          <Row label="Height (cm)" value={profile.height_cm} />
          <Row label="Current weight (kg)" value={profile.weight_kg} />
          <Row label="Target weight (kg)" value={profile.target_weight_kg ?? profile.goal_weight} />
          <Row label="Target date" value={profile.target_date ? new Date(profile.target_date).toLocaleDateString() : null} />
          <Row label="Activity level" value={profile.activity_level} />
          <Row label="Dietary pattern" value={profile.dietary_pattern} />
          <Row label="Meat policy" value={profile.meat_policy} />
          <Row label="Allergies" value={arrish(profile.allergies)} />
          <Row label="Dislikes" value={profile.dislikes} />
          <Row label="Cuisines" value={arrish(profile.cuisine_prefs) || arrish(profile.cuisines)} />
          <Row label="Injuries" value={arrish(profile.injuries)} />
          <Row label="Health conditions" value={arrish(profile.health_conditions) || arrish(profile.conditions)} />
          <Row label="Available equipment" value={arrish(profile.equipment)} />

          <div className="flex" style={{gap:10, marginTop:6}}>
            <Link className="button" href="/onboarding">Edit in onboarding</Link>
            <Link className="button-outline" href="/profile">Back to Profile</Link>
          </div>
        </div>
      )}
    </div>
  )
}
