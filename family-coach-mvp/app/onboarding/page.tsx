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

  // Family inline
  const [familyMode, setFamilyMode] = useState<'none' | 'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  // Custom adders
  const [injuryInput, setInjuryInput] = useState('')
  const [injuriesExtra, setInjuriesExtra] = useState<string[]>([])

  const [conditionsInput, setConditionsInput] = useState('')
  const [conditionsExtra, setConditionsExtra] = useState<string[]>([])

  const [equipInput, setEquipInput] = useState('')
  const [equipExtra, setEquipExtra] = useState<string[]>([])

  const [allergyInput, setAllergyInput] = useState('')
  const [allergyExtra, setAllergyExtra] = useState<string[]>([])

  const [cuisineInput, setCuisineInput] = useState('')
  const [cuisineExtra, setCuisineExtra] = useState<string[]>([])

  const [dislikeInput, setDislikeInput] = useState('')
  const [dislikesExtra, setDislikesExtra] = useState<string[]>([])

  useEffect(()=>{
    fetch('/data/questionnaire_schema_v1.json').then(r=>r.json()).then(setSchema)
    supabase.auth.getUser().then(({ data }) => {
      if(data.user?.email){
        setValues(v => ({ ...v, email: data.user!.email }))
      }
    }).finally(()=>setLoading(false))
  }, [])

  const toggleCheckbox = (id: string, option: string) => {
    setValues(v => {
      const arr = Array.isArray(v[id]) ? [...v[id]] : []
      const idx = arr.indexOf(option)
      if (idx >= 0) arr.splice(idx, 1); else arr.push(option)
      return { ...v, [id]: arr }
    })
  }

  const handleChange = (id:string, val:any) => setValues(v=>({...v, [id]:val}))

  const addTo = (which: 'injuries'|'conditions'|'equipment'|'allergies'|'cuisines'|'dislikes') => {
    const map: any = {
      injuries: [injuryInput, setInjuryInput, injuriesExtra, setInjuriesExtra],
      conditions: [conditionsInput, setConditionsInput, conditionsExtra, setConditionsExtra],
      equipment: [equipInput, setEquipInput, equipExtra, setEquipExtra],
      allergies: [allergyInput, setAllergyInput, allergyExtra, setAllergyExtra],
      cuisines: [cuisineInput, setCuisineInput, cuisineExtra, setCuisineExtra],
      dislikes: [dislikeInput, setDislikeInput, dislikesExtra, setDislikesExtra],
    }
    const [val, setVal, arr, setArr] = map[which] as [string, any, string[], any]
    const t = (val||'').trim()
    if(!t) return
    if (!arr.includes(t)) setArr([...arr, t])
    setVal('')
  }

  const merged = (id:string, extras:string[]) => {
    const base = Array.isArray(values[id]) ? values[id] : []
    return [...base, ...extras].filter(Boolean)
  }

  const saveProfileAndFamily = async() => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ alert('Please sign in first'); setSaving(false); return }

      // Create or join a family (optional)
      let family_id: string | null = null
      if (familyMode === 'create' && familyName.trim()){
        const invite_code = Math.random().toString(36).slice(2,8)
        const { data: fam, error: ef } = await supabase
          .from('families')
          .insert({ name: familyName.trim(), owner_user_id: user.id, invite_code })
          .select().single()
        if (ef) { alert(ef.message); setSaving(false); return }
        family_id = fam.id
        await supabase.from('family_members').insert({ family_id, user_id: user.id, role: 'owner' })
      } else if (familyMode === 'join' && inviteCode.trim()){
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

      const injuries = merged('injuries', injuriesExtra)
      const conditions = merged('conditions', conditionsExtra)
      const equipment = merged('equipment', equipExtra)
      const allergies = merged('allergies', allergyExtra)
      const cuisines = merged('cuisines', cuisineExtra)
      const dislikes = dislikesExtra.join(', ')  // store as text CSV to avoid schema change

      // Build profile payload
      const payload:any = {
        id: user.id,
        family_id,
        full_name: values['full_name'] || null,
        sex: values['sex'] || null,
        dob: values['dob'] || null,
        height_cm: values['height_cm'] ? Number(values['height_cm']) : null,
        weight_kg: values['weight_kg'] ? Number(values['weight_kg']) : null,
        target_weight_kg: values['target_weight_kg'] ? Number(values['target_weight_kg']) : null,
        target_date: values['target_date'] || null,
        activity_level: values['activity_level'] || 'sedentary (little/no exercise)',
        dietary_pattern: values['dietary_pattern'] || 'non-veg',
        allergies,
        dislikes,
        cuisines,
        budget_level: values['budget_level'] || null,
        meals_per_day: values['meals_per_day'] ? Number(values['meals_per_day']) : 3,
        fasting_window: values['fasting_window'] || null,
        primary_goal: values['primary_goal'] || 'fat loss',
        secondary_goal: values['secondary_goal'] || null,
        equipment,
        step_goal: values['step_goal'] ? Number(values['step_goal']) : null,
        sleep_hours: values['sleep_hours'] ? Number(values['sleep_hours']) : null,
        time_per_workout_min: values['time_per_workout_min'] ? Number(values['time_per_workout_min']) : 25,
        conditions,
        injuries
      }

      const { error: perr } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
      if (perr) { alert(perr.message); setSaving(false); return }

      alert('Onboarding complete!')
      router.push('/')
    } finally {
      setSaving(false)
    }
  }

  if(loading) return <div className="card"><p>Loading…</p></div>
  if(!schema) return <div className="card"><p>Schema missing</p></div>

  return (
    <div className="card">
      <h2 style={{marginTop:0}}>Onboarding</h2>
      {schema.sections.map(sec => (
        <div key={sec.id}>
          <h3 style={{marginBottom:8}}>{sec.title}</h3>
          <div className="grid">
            {sec.fields.map(f => (
              <div key={f.id}>
                <label><small>{f.label}</small></label>
                {f.type === 'select' ? (
                  <select className="input" value={values[f.id] ?? ''} onChange={(e)=>handleChange(f.id, e.currentTarget.value)}>
                    <option value="" disabled>— Select —</option>
                    {(f.options||[]).map((o:any)=> <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                  </select>
                ) : f.type === 'checkboxes' ? (
                  <div className="checkbox-group">
                    {(f.options||[]).map((o:any)=> {
                      const checked = Array.isArray(values[f.id]) && values[f.id].includes(o)
                      return (
                        <label key={String(o)} className="checkbox-item">
                          <input type="checkbox" checked={checked} onChange={()=>toggleCheckbox(f.id, String(o))} />
                          <span>{String(o)}</span>
                        </label>
                      )
                    })}
                    {['injuries','conditions','equipment','allergies','cuisines'].includes(f.id) && (
                      <div style={{gridColumn:'1 / -1'}}>
                        <div className="grid grid-2">
                          <input className="input" placeholder={"Add another " + f.id.slice(0,-1) + "…"} value={
                            f.id==='injuries'?injuryInput: f.id==='conditions'?conditionsInput: f.id==='equipment'?equipInput: f.id==='allergies'?allergyInput: cuisineInput
                          } onChange={(e)=>{
                            const v = e.target.value
                            if (f.id==='injuries') setInjuryInput(v)
                            else if (f.id==='conditions') setConditionsInput(v)
                            else if (f.id==='equipment') setEquipInput(v)
                            else if (f.id==='allergies') setAllergyInput(v)
                            else setCuisineInput(v)
                          }} />
                          <button className="button" onClick={()=>addTo(f.id as any)} type="button">Add</button>
                        </div>
                        <div className="pills" style={{marginTop:8}}>
                          {(f.id==='injuries'?injuriesExtra: f.id==='conditions'?conditionsExtra: f.id==='equipment'?equipExtra: f.id==='allergies'?allergyExtra: cuisineExtra).map(x => <span key={x} className="pill">{x}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <input className="input"
                    type={f.type==='number' ? 'number' : (f.type==='date' ? 'date' : 'text')}
                    value={values[f.id] ?? ''}
                    onChange={e=>handleChange(f.id, e.currentTarget.value)}
                    disabled={f.id==='email'}
                  />
                )}
                {f.id==='dislikes' && (
                  <div style={{marginTop:8}}>
                    <div className="grid grid-2">
                      <input className="input" placeholder="Add a food you dislike…" value={dislikeInput} onChange={e=>setDislikeInput(e.target.value)} />
                      <button className="button" onClick={()=>addTo('dislikes')} type="button">Add</button>
                    </div>
                    {dislikesExtra.length>0 && (
                      <div className="pills" style={{marginTop:8}}>
                        {dislikesExtra.map(x => <span key={x} className="pill">{x}</span>)}
                      </div>
                    )}
                  </div>
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
        <div style={{display:'flex',gap:16,marginBottom:8}}>
          <label style={{display:'flex',alignItems:'center',gap:8}}><input type="radio" name="familyMode" checked={familyMode==='create'} onChange={()=>setFamilyMode('create')} /> Create new</label>
          <label style={{display:'flex',alignItems:'center',gap:8}}><input type="radio" name="familyMode" checked={familyMode==='join'} onChange={()=>setFamilyMode('join')} /> Join with code</label>
          <label style={{display:'flex',alignItems:'center',gap:8}}><input type="radio" name="familyMode" checked={familyMode==='none'} onChange={()=>setFamilyMode('none')} /> Skip for now</label>
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
