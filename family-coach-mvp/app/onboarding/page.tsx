'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'
import './onboarding-ui.css'

type Profile = {
  full_name?: string | null
  sex?: string | null
  height_cm?: number | null
  goal_weight?: number | null
  current_weight?: number | null 
  goal_target_date?: string | null
  dietary_pattern?: string | null
  meat_policy?: string | null
  allergies?: string[] | null
  dislikes?: string[] | null
  cuisine_prefs?: string[] | null
  injuries?: string[] | null
  health_conditions?: string[] | null
  equipment?: string[] | null
  dob?: string | null
  activity_level?: string | null
}

const DIET_CHOICES = [
  { key: 'veg', label: 'Vegetarian' },
  { key: 'non_veg_chicken_only', label: 'Non-veg (chicken only)' },
  { key: 'non_veg', label: 'Non-veg (all meats)' },
]

const SEX_CHOICES = [
  { key: 'male', label: 'Male' },
  { key: 'female', label: 'Female' },
  { key: 'other', label: 'Other' },
]

const ACTIVITY_CHOICES = [
  { key: 'sedentary', label: 'Sedentary' },
  { key: 'light', label: 'Lightly active' },
  { key: 'active', label: 'Active' },
  { key: 'very_active', label: 'Very active' },
]

function ymdLocal(d = new Date()){
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

function cleanList(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const k = (raw || '').trim()
    if (!k) continue
    const norm = k.replace(/\s+/g, ' ')
    const sig = norm.toLowerCase()
    if (!seen.has(sig)) { seen.add(sig); out.push(norm) }
  }
  return out
}

export default function OnboardingPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success', text: string } | null>(null)

  // personal
  const [fullName, setFullName] = useState('')
  const [sex, setSex] = useState('male')
  const [dob, setDob] = useState('')                         // yyyy-mm-dd
  const [height, setHeight] = useState('')                   // cm
  const [currentWeight, setCurrentWeight] = useState('')     // kg
  const [goalWeight, setGoalWeight] = useState('')           // kg
  const [goalDate, setGoalDate] = useState('')               // yyyy-mm-dd
  const [activity, setActivity] = useState('light')          // NEW

  // diet & exercise
  const [diet, setDiet] = useState('veg')
  const [allergies, setAllergies] = useState<string[]>([])
  const [dislikes, setDislikes] = useState<string[]>([])
  const [cuisines, setCuisines] = useState<string[]>([])
  const [injuries, setInjuries] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [equipment, setEquipment] = useState<string[]>([])

  function ChipEditor({
    label, items, setItems, placeholder
  }: {
    label: string
    items: string[]
    setItems: (v: string[]) => void
    placeholder?: string
  }){
    const [val, setVal] = useState('')
    const inpRef = useRef<HTMLInputElement|null>(null)
    function add(){
      const v = val.trim()
      if(!v) return
      setItems(cleanList([...items, v]))
      setVal('')
      requestAnimationFrame(()=> inpRef.current?.focus())
    }
    function remove(idx:number){
      const next = [...items]; next.splice(idx,1); setItems(next)
      requestAnimationFrame(()=> inpRef.current?.focus())
    }
    return (
      <div className="chip-editor" style={{marginTop:10}}>
        <label className="lbl">{label}</label>
        <div className="chips wrap">
          {items.map((t,i)=>(
            <span key={`${t}-${i}`} className="chip pill">
              {t}
              <button className="x" onClick={()=>remove(i)} aria-label="remove">×</button>
            </span>
          ))}
        </div>
        <div className="chip-input-row">
          <input
            ref={inpRef}
            className="chip-input"
            placeholder={placeholder || `Add ${label.toLowerCase()}…`}
            value={val}
            onChange={e=>setVal(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); add() } }}
            autoCapitalize="none" autoCorrect="off" autoComplete="off" enterKeyHint="done"
          />
          <button className="chip add" onClick={add}>Add</button>
        </div>
      </div>
    )
  }

  // Prefill
  useEffect(()=>{ (async()=>{
    setLoading(true); setMsg(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user){ setMsg({kind:'error', text:'Please sign in to continue.'}); return }

      const sel =
        'full_name, sex, dob, height_cm, current_weight, goal_weight, goal_target_date, activity_level, '+
        'dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
      const prof = await supabase.from('profiles').select(sel).eq('id', user.id).maybeSingle()
      const p = (prof.data || {}) as Profile

      if(p.full_name) setFullName(p.full_name)
      if(p.sex) setSex(p.sex)
      if(p.dob) setDob(p.dob.substring(0,10))
      if(p.height_cm!=null) setHeight(String(p.height_cm))
      if(p.current_weight!=null) setCurrentWeight(String(p.current_weight))
      if(p.goal_weight!=null) setGoalWeight(String(p.goal_weight))
      if(p.goal_target_date) setGoalDate(p.goal_target_date.substring(0,10))
      if(p.activity_level) setActivity(p.activity_level)

      if(p.dietary_pattern) setDiet(p.dietary_pattern)
      else if(p.meat_policy) setDiet(p.meat_policy)

      setAllergies(p.allergies || [])
      setDislikes(p.dislikes || [])
      setCuisines(p.cuisine_prefs || [])
      setInjuries(p.injuries || [])
      setConditions(p.health_conditions || [])
      setEquipment(p.equipment || [])

      // latest weight as fallback for currentWeight
      if(!p.current_weight){
        const w = await supabase
          .from('weights')
          .select('date, weight_kg')
          .eq('user_id', user.id)
          .order('date', { ascending:false })
          .limit(1)
          .maybeSingle()
        if(w.data?.weight_kg!=null) setCurrentWeight(String(w.data.weight_kg))
      }
    }catch(e){
      console.warn(e); setMsg({kind:'error', text:'Could not load your details.'})
    }finally{ setLoading(false) }
  })() }, [supabase])

  async function onSave(){
    setSaving(true); setMsg(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user){ setMsg({kind:'error', text:'Please sign in first.'}); return }

      const payload:any = {
        id: user.id,
        full_name: fullName.trim() || null,
        sex: sex || null,
        dob: dob || null,
        height_cm: height ? Number(height) : null,
        current_weight: currentWeight ? Number(currentWeight) : null,
        goal_weight: goalWeight ? Number(goalWeight) : null,
        goal_target_date: goalDate || null,
        activity_level: activity || null,
        dietary_pattern: diet || null,
        meat_policy: diet || null,
        allergies: cleanList(allergies),
        dislikes: cleanList(dislikes),
        cuisine_prefs: cleanList(cuisines),
        injuries: cleanList(injuries),
        health_conditions: cleanList(conditions),
        equipment: cleanList(equipment),
      }

      const up = await supabase.from('profiles').upsert(payload, { onConflict:'id' }).select('id').maybeSingle()
      if(up.error){ console.error(up.error); setMsg({kind:'error', text: up.error.message}); return }

      // store today's weight as a log too (if user typed one)
      const wt = currentWeight ? Number(currentWeight) : NaN
      if(!Number.isNaN(wt)){
        const today = ymdLocal()
        const ex = await supabase.from('weights').select('id').eq('user_id', user.id).eq('date', today).maybeSingle()
        if(ex.data?.id){ await supabase.from('weights').update({ weight_kg: wt }).eq('id', ex.data.id) }
        else { await supabase.from('weights').insert({ user_id: user.id, date: today, weight_kg: wt }) }
      }

      setMsg({kind:'success', text:'Saved your details.'})
      router.push('/profile')
    }catch(e:any){
      console.error(e); setMsg({kind:'error', text:'Something went wrong while saving.'})
    }finally{ setSaving(false) }
  }

  return (
    <div className="container ob-wrap">
      <h1 className="page-h1">Tell us about you</h1>

      {msg && <div className={`banner ${msg.kind==='error'?'error':'ok'}`} style={{marginBottom:12}}>{msg.text}</div>}

      {/* Personal */}
      <section className="panel">
        <div className="panel-title">Your details</div>
        <div className="grid">
          <label className="lbl">Full name</label>
          <input className="line-input" placeholder="Full name" value={fullName} onChange={e=>setFullName(e.target.value)} />

          <label className="lbl" style={{marginTop:8}}>Date of birth</label>
          <input className="pill-input" type="date" value={dob} onChange={e=>setDob(e.target.value)} />

          <div className="grid-2">
            <div>
              <label className="lbl">Sex</label>
              <div className="chips">
                {SEX_CHOICES.map(opt=>(
                  <button key={opt.key} className={`chip ${sex===opt.key?'on':''}`} onClick={()=>setSex(opt.key)}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="lbl">Height (cm)</label>
              <input className="pill-input" inputMode="numeric" pattern="[0-9]*" placeholder="e.g., 175" value={height} onChange={e=>setHeight(e.target.value)} />
            </div>
          </div>

          <div className="grid-3">
            <div>
              <label className="lbl">Current weight (kg)</label>
              <input className="pill-input" inputMode="decimal" placeholder="e.g., 82" value={currentWeight} onChange={e=>setCurrentWeight(e.target.value)} />
            </div>
            <div>
              <label className="lbl">Goal weight (kg)</label>
              <input className="pill-input" inputMode="decimal" placeholder="e.g., 78" value={goalWeight} onChange={e=>setGoalWeight(e.target.value)} />
            </div>
            <div>
              <label className="lbl">Target date</label>
              <input className="pill-input" type="date" value={goalDate} onChange={e=>setGoalDate(e.target.value)} />
            </div>
          </div>

          <div style={{marginTop:8}}>
            <label className="lbl">Activity level</label>
            <div className="chips">
              {ACTIVITY_CHOICES.map(opt=>(
                <button key={opt.key} className={`chip ${activity===opt.key?'on':''}`} onClick={()=>setActivity(opt.key)}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Diet */}
      <section className="panel">
        <div className="panel-title">Diet preferences</div>
        <div className="lbl">Dietary pattern</div>
        <div className="chips">
          {DIET_CHOICES.map(opt=>(
            <button key={opt.key} className={`chip ${diet===opt.key?'on':''}`} onClick={()=>setDiet(opt.key)}>{opt.label}</button>
          ))}
        </div>

        <ChipEditor label="Allergies" items={allergies} setItems={setAllergies} />
        <ChipEditor label="Dislikes" items={dislikes} setItems={setDislikes} />
        <ChipEditor label="Cuisine preferences" items={cuisines} setItems={setCuisines} />
      </section>

      {/* Exercise */}
      <section className="panel">
        <div className="panel-title">Exercise constraints</div>
        <ChipEditor label="Injuries" items={injuries} setItems={setInjuries} />
        <ChipEditor label="Health conditions" items={conditions} setItems={setConditions} />
        <ChipEditor label="Equipment you have" items={equipment} setItems={setEquipment} placeholder="e.g., none, dumbbells, band" />
      </section>

      <div className="actions">
        <button className="button" onClick={onSave} disabled={saving}>{saving?'Saving…':'Save & continue'}</button>
      </div>

      {loading && <div className="muted" style={{marginTop:8}}>Loading…</div>}
    </div>
  )
}
