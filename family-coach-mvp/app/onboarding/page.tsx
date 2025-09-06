
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Field = { id: string; label: string; type: string; required?: boolean; options?: any }
type Section = { id: string; title: string; fields: Field[] }
type Schema = { sections: Section[] }

export default function Onboarding(){
  const supabase = createClient()
  const [schema, setSchema] = useState<Schema | null>(null)
  const [values, setValues] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    fetch('/data/questionnaire_schema_v1.json').then(r=>r.json()).then(setSchema).finally(()=>setLoading(false))
  }, [])

  const handleChange = (id:string, val:any) => setValues(v=>({...v, [id]:val}))

  const saveProfile = async() => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Please sign in first'); return }
    const payload:any = {
      id: user.id,
      dietary_pattern: values['dietary_pattern'] || 'omnivore',
      height_cm: Number(values['height_cm']||0),
      weight_kg: Number(values['weight_kg']||0),
      target_weight_kg: Number(values['target_weight_kg']||0),
      activity_level: values['activity_level']||'sedentary (little/no exercise)',
      primary_goal: values['primary_goal']||'fat loss',
      time_per_workout_min: Number(values['time_per_workout_min']||25),
      allergies: (values['allergies'] && Array.isArray(values['allergies'])) ? values['allergies'] : [],
      cuisines: (values['cuisines'] && Array.isArray(values['cuisines'])) ? values['cuisines'] : [],
      meals_per_day: Number(values['meals_per_day']||3)
    }
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
    if(error) alert(error.message); else alert('Saved!')
  }

  if(loading) return <p>Loading…</p>
  if(!schema) return <p>Schema missing</p>

  return (
    <div className="card">
      <h2>Onboarding</h2>
      {schema.sections.map(sec => (
        <div key={sec.id}>
          <h3>{sec.title}</h3>
          <div className="grid">
            {sec.fields.map(f => (
              <div key={f.id}>
                <label><small>{f.label}</small></label>
                {f.type === 'select' || f.type === 'multiselect' ? (
                  <select className="input" multiple={f.type==='multiselect'} onChange={(e)=>{
                    const vals = f.type==='multiselect'
                      ? Array.from(e.currentTarget.selectedOptions).map(o=>o.value)
                      : e.currentTarget.value
                    handleChange(f.id, vals)
                  }}>
                    {(f.options||[]).map((o:any)=> <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                  </select>
                ) : (
                  <input className="input" type={f.type==='number' ? 'number' : (f.type==='date' ? 'date' : 'text')}
                    onChange={e=>handleChange(f.id, e.currentTarget.value)} />
                )}
              </div>
            ))}
          </div>
          <hr/>
        </div>
      ))}
      <button className="button" onClick={saveProfile}>Save Profile</button>
    </div>
  )
}
