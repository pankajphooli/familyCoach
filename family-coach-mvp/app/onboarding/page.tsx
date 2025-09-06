'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'

type Field = { id: string; label: string; type: string; required?: boolean; options?: any }
type Section = { id: string; title: string; fields: Field[] }
type Schema = { sections: Section[] }

export default function Onboarding(){
  const supabase = createClient()
  const router = useRouter()
  const [schema, setSchema] = useState<Schema | null>(null)
  const [values, setValues] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [familyMode, setFamilyMode] = useState<'none' | 'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  useEffect(()=>{
    fetch('/data/questionnaire_schema_v1.json').then(r=>r.json()).then(setSchema).finally(()=>setLoading(false))
  }, [])

  const handleChange = (id:string, val:any) => setValues(v=>({...v, [id]:val}))

  const saveProfileAndFamily = async() => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ alert('Please sign in first'); setSaving(false); return }

      // 1) Create or join a family (optional)
      let family_id: string | null = null
      if (familyMode === 'create' && familyName.trim().length > 0){
        const invite_code = Math.random().toString(36).slice(2,8)
        const { data: fam, error: ef } = await supabase
          .from('families')
          .insert({ name: familyName.trim(), owner_user_id: user.id, invite_code })
          .select()
          .single()
        if (ef) { alert(ef.message); setSaving(false); return }
        family_id = fam.id
        await supabase.from('family_members').insert({ family_id, user_id: user.id, role: 'owner' })
      } else if (familyMode === 'join' && inviteCode.trim().length > 0){
        const { data: fam, error: sf } = await supabase
          .from('families')
          .select('id, invite_code, name')
          .eq('invite_code', inviteCode.trim())
          .maybeSingle()
        if (sf || !fam){ alert('Invalid invite code'); setSaving(false); return }
        family_id = fam.id
        const { error: mErr } = await supabase.from('family_members').insert({ family_id, user_id: user.id, role: 'member' })
        if (mErr) { alert(mErr.message); setSaving(false); return }
      }

      // 2) Save profile (with optional family_id)
      const payload:any = {
        id: user.id,
        family_id: family_id,
        dietary_pattern: values['dietary_pattern'] || 'omnivore',
        height_cm: values['height_cm'] ? Number(values['height_cm']) : null,
        weight_kg: values['weight_kg'] ? Number(values['weight_kg']) : null,
        target_weight_kg: values['target_weight_kg'] ? Number(values['target_weight_kg']) : null,
        activity_level: values['activity_level'] || 'sedentary (little/no exercise)',
        primary_goal: values['primary_goal'] || 'fat loss',
        time_per_workout_min: values['time_per_workout_min'] ? Number(values['time_per_workout_min']) : 25,
        allergies: (values['allergies'] && Array.isArray(values['allergies'])) ? values['allergies'] : [],
        cuisines: (values['cuisines'] && Array.isArray(values['cuisines'])) ? values['cuisines'] : [],
        meals_per_day: values['meals_per_day'] ? Number(values['meals_per_day']) : 3
      }
      const { error: perr } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
      if (perr) { alert(perr.message); setSaving(false); return }

      alert('Onboarding complete!')
      router.push('/today')
    } finally {
      setSaving(false)
    }
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

      {/* Family setup embedded in onboarding */}
      <div>
        <h3>Family</h3>
        <div className="flex" style={{gap:16, marginBottom:8}}>
          <label className="flex"><input type="radio" name="familyMode" checked={familyMode==='create'} onChange={()=>setFamilyMode('create')} /> Create new</label>
          <label className="flex"><input type="radio" name="familyMode" checked={familyMode==='join'} onChange={()=>setFamilyMode('join')} /> Join with code</label>
          <label className="flex"><input type="radio" name="familyMode" checked={familyMode==='none'} onChange={()=>setFamilyMode('none')} /> Skip for now</label>
        </div>
        {familyMode === 'create' && (
          <div className="grid">
            <input className="input" placeholder="Family name" value={familyName} onChange={e=>setFamilyName(e.target.value)} />
            <small className="muted">You can invite others later from the Family page.</small>
          </div>
        )}
        {familyMode === 'join' && (
          <div className="grid">
            <input className="input" placeholder="Invite code" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} />
            <small className="muted">Ask your family owner for the 6-character code.</small>
          </div>
        )}
      </div>

      <hr/>
      <button className="button" onClick={saveProfileAndFamily} disabled={saving}>{saving ? 'Saving…' : 'Finish Onboarding'}</button>
    </div>
  )
}
