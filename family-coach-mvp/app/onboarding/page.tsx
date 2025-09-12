'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'
import './onboarding-ui.css'

type Profile = {
  full_name?: string | null
  sex?: string | null
  height_cm?: number | null
  goal_weight?: number | null
  goal_target_date?: string | null
  dietary_pattern?: string | null
  meat_policy?: string | null
  allergies?: string[] | null
  dislikes?: string[] | null
  cuisine_prefs?: string[] | null
  injuries?: string[] | null
  health_conditions?: string[] | null
  equipment?: string[] | null
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

  // form fields
  const [fullName, setFullName] = useState('')
  const [sex, setSex] = useState<string>('male')
  const [height, setHeight] = useState<string>('')       // cm
  const [goalWeight, setGoalWeight] = useState<string>('') // kg
  const [goalDate, setGoalDate] = useState<string>('')     // yyyy-mm-dd

  const [diet, setDiet] = useState<string>('veg')
  const [allergies, setAllergies] = useState<string[]>([])
  const [dislikes, setDislikes] = useState<string[]>([])
  const [cuisines, setCuisines] = useState<string[]>([])
  const [injuries, setInjuries] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [equipment, setEquipment] = useState<string[]>([])

  function useChipInput(list: string[], setList: (v: string[]) => void) {
    const [val, setVal] = useState('')
    const add = () => {
      const n = val.trim()
      if (!n) return
      setList(cleanList([...list, n]))
      setVal('')
    }
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') { e.preventDefault(); add() }
    }
    const remove = (idx: number) => {
      const next = [...list]; next.splice(idx, 1); setList(next)
    }
    return { val, setVal, add, onKeyDown, remove }
  }

  const al = useChipInput(allergies, setAllergies)
  const dl = useChipInput(dislikes, setDislikes)
  const cu = useChipInput(cuisines, setCuisines)
  const ij = useChipInput(injuries, setInjuries)
  const hc = useChipInput(conditions, setConditions)
  const eq = useChipInput(equipment, setEquipment)

  function notify(kind: 'success' | 'error', msg: string) {
    (window as any)?.toast?.(kind, msg)
  }

  // Prefill from existing profile
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }

        const sel =
          'full_name, sex, height_cm, goal_weight, goal_target_date, dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment'
        const res = await supabase
          .from('profiles')
          .select(sel)
          .eq('id', user.id)
          .maybeSingle()

        const p = (res.data || {}) as Profile

        if (p.full_name) setFullName(p.full_name)
        if (p.sex) setSex(p.sex)
        if (p.height_cm != null) setHeight(String(p.height_cm))
        if (p.goal_weight != null) setGoalWeight(String(p.goal_weight))
        if (p.goal_target_date) setGoalDate(p.goal_target_date.substring(0, 10))

        if (p.dietary_pattern) setDiet(p.dietary_pattern)
        else if (p.meat_policy) setDiet(p.meat_policy)

        setAllergies(p.allergies || [])
        setDislikes(p.dislikes || [])
        setCuisines(p.cuisine_prefs || [])
        setInjuries(p.injuries || [])
        setConditions(p.health_conditions || [])
        setEquipment(p.equipment || [])
      } finally {
        setLoading(false)
      }
    })()
  }, [supabase])

  async function onSave() {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { notify('error', 'Please sign in first'); return }

      const payload: any = {
        id: user.id,
        full_name: fullName.trim() || null,
        sex: sex || null,
        height_cm: height ? Number(height) : null,
        goal_weight: goalWeight ? Number(goalWeight) : null,
        goal_target_date: goalDate || null,
        dietary_pattern: diet || null,
        meat_policy: diet || null,
        allergies: cleanList(allergies),
        dislikes: cleanList(dislikes),
        cuisine_prefs: cleanList(cuisines),
        injuries: cleanList(injuries),
        health_conditions: cleanList(conditions),
        equipment: cleanList(equipment),
      }

      const up = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select('id')
        .maybeSingle()

      if (up.error) { notify('error', up.error.message); return }

      notify('success', 'Saved your details')
      router.push('/profile') // ← go to “Your details” page
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container ob-wrap">
      <h1 className="page-h1">Tell us about you</h1>

      {/* Personal */}
      <section className="panel">
        <div className="panel-title">Your details</div>
        <div className="grid">
          <label className="lbl">Full name</label>
          <input className="line-input" placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} />

          <div className="grid-2">
            <div>
              <label className="lbl">Sex</label>
              <div className="chips">
                {SEX_CHOICES.map(opt => (
                  <button
                    key={opt.key}
                    className={`chip ${sex === opt.key ? 'on' : ''}`}
                    onClick={() => setSex(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="lbl">Height (cm)</label>
              <input
                className="pill-input"
                inputMode="decimal"
                placeholder="e.g., 175"
                value={height}
                onChange={e => setHeight(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label className="lbl">Goal weight (kg)</label>
              <input className="pill-input" inputMode="decimal" placeholder="e.g., 78" value={goalWeight} onChange={e => setGoalWeight(e.target.value)} />
            </div>
            <div>
              <label className="lbl">Target date</label>
              <input className="pill-input" type="date" value={goalDate} onChange={e => setGoalDate(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      {/* Diet */}
      <section className="panel">
        <div className="panel-title">Diet preferences</div>

        <div className="lbl">Dietary pattern</div>
        <div className="chips">
          {DIET_CHOICES.map(opt => (
            <button
              key={opt.key}
              className={`chip ${diet === opt.key ? 'on' : ''}`}
              onClick={() => setDiet(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <ChipEditor label="Allergies" hook={useChipInputProxy(al)} items={allergies} />
        <ChipEditor label="Dislikes" hook={useChipInputProxy(dl)} items={dislikes} />
        <ChipEditor label="Cuisine preferences" hook={useChipInputProxy(cu)} items={cuisines} />
      </section>

      {/* Exercise */}
      <section className="panel">
        <div className="panel-title">Exercise constraints</div>
        <ChipEditor label="Injuries" hook={useChipInputProxy(ij)} items={injuries} />
        <ChipEditor label="Health conditions" hook={useChipInputProxy(hc)} items={conditions} />
        <ChipEditor label="Equipment you have" hook={useChipInputProxy(eq)} items={equipment} placeholder="e.g., none, dumbbells, band" />
      </section>

      <div className="actions">
        <button className="button" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save & continue'}</button>
      </div>

      {loading && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
    </div>
  )
}

/** small adapter to avoid re-creating objects in JSX */
function useChipInputProxy(h: { val:string; setVal:(v:string)=>void; add:()=>void; onKeyDown:(e:React.KeyboardEvent<HTMLInputElement>)=>void; remove:(i:number)=>void }) {
  return h
}

function ChipEditor({
  label,
  hook,
  items,
  placeholder,
}: {
  label: string
  hook: { val:string; setVal:(v:string)=>void; add:()=>void; onKeyDown:(e:React.KeyboardEvent<HTMLInputElement>)=>void; remove:(i:number)=>void }
  items: string[]
  placeholder?: string
}) {
  return (
    <div className="chip-editor" style={{marginTop: 10}}>
      <label className="lbl">{label}</label>
      <div className="chips wrap">
        {items.map((t, i) => (
          <span key={i} className="chip pill">
            {t}
            <button className="x" onClick={() => hook.remove(i)} aria-label="remove">×</button>
          </span>
        ))}
        <input
          className="chip-input"
          placeholder={placeholder || `Add ${label.toLowerCase()}…`}
          value={hook.val}
          onChange={e => hook.setVal(e.target.value)}
          onKeyDown={hook.onKeyDown}
        />
        <button className="chip add" onClick={hook.add}>Add</button>
      </div>
    </div>
  )
}
