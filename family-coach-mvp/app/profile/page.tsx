'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

export default function Profile(){
  const supabase = createClient()
  const [profile, setProfile] = useState<any>(null)
  const [edit, setEdit] = useState<boolean>(false)
  const [values, setValues] = useState<Record<string, any>>({})

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setProfile(p || null)
    setValues(p || {})
  }

  useEffect(()=>{ load() }, [])

  const handleChange = (id:string, val:any) => setValues(v=>({ ...v, [id]: val }))

  const save = async () => {
    const { error } = await supabase.from('profiles').update(values).eq('id', values.id)
    if (error) { alert(error.message); return }
    setEdit(false)
    await load()
  }

  if (!profile) return <div className="card"><p>Loading…</p></div>

  const fields = [
    ['full_name','Full name'], ['email','Email (from auth, read-only)'], ['sex','Sex'], ['dob','Date of birth'],
    ['height_cm','Height (cm)'], ['weight_kg','Current weight (kg)'], ['target_weight_kg','Target weight (kg)'],
    ['target_date','Target date'], ['activity_level','Activity level'], ['dietary_pattern','Dietary pattern'],
    ['allergies','Allergies'], ['cuisines','Cuisines'], ['dislikes','Dislikes'],
    ['meals_per_day','Meals/day'], ['fasting_window','Fasting'], ['primary_goal','Primary goal'], ['secondary_goal','Secondary goal'],
    ['equipment','Equipment'], ['conditions','Health conditions'], ['injuries','Injuries'], ['step_goal','Step goal'], ['sleep_hours','Sleep hours'],
    ['time_per_workout_min','Time per workout (min)']
  ]

  return (
    <div className="grid">
      <div className="card">
        <h2>Your Profile</h2>
        {!edit && <button className="button" onClick={()=>setEdit(true)}>Edit</button>}
        {edit && <button className="button" onClick={save}>Save</button>}
      </div>
      <div className="card">
        <div className="grid grid-3">
          {fields.map(([k,label]) => (
            <div key={k as string}>
              <small className="muted">{label}</small>
              {!edit ? (
                <div>{Array.isArray(profile[k as string]) ? JSON.stringify(profile[k as string]) : String(profile[k as string] ?? '—')}</div>
              ) : (
                <input className="input" value={String(values[k as string] ?? '')} onChange={e=>handleChange(k as string, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
