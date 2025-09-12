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

function ymdLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
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

  // form state
  const [fullName, setFullName] = useState('')
  const [sex, setSex] = useState('male')
  const [height, setHeight] = useState('') // cm
  const [currentWeight, setCurrentWeight] = useState('') // kg
  const [goalWeight, setGoalWeight] = useState('') // kg
  const [goalDate, setGoalDate] = useState('') // yyyy-mm-dd

  const [diet, setDiet] = useState('veg')
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

  useEffect(() => {
    (async () => {
      setLoading(true)
      setMsg(null)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setMsg({ kind: 'error', text: 'Please sign in to continue.' }); return }

        // profile
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

        // latest weight
        const w = await supabase
          .from('weights')
          .select('date, weight_kg')
          .eq('user_id', user.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (w.data?.weight_kg != null) setCurrentWeight(String(w.data.weight_kg))
      } catch (e) {
        console.warn('Onboarding prefill error', e)
        setMsg({ kind: 'error', text: 'Could not load your details.' })
      } finally {
        setLoading(false)
      }
    })()
  }, [supabase])

  async function onSave() {
    setSaving(true)
    setMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setMsg({ kind: 'error', text: 'Please sign in first.' }); return }

      // Build profile payload
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

      // Upsert profile
      const up = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select('id')
        .maybeSingle()

      if (up.error) {
        console.error('Profile upsert error', up.error)
        setMsg({ kind: 'error', text: up.error.message })
        return
      }

      // Save today’s weight if provided
      const wt = currentWeight ? Number(currentWeight) : NaN
      if (!Number.isNaN(wt)) {
        const today = ymdLocal()
        const ex = await supabase
          .from('weights')
          .select('id')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle()

        if (ex.data?.id) {
          const upd = await supabase.from('weights').update({ weight_kg: wt }).eq('id', ex.data.id)
          if (upd.error) console.warn('weights update error', upd.error)
        } else {
          const ins = await supabase.from('weights').insert({ user_id: user.id, date: today, weight_kg: wt })
          if (ins.error) console.warn('weights insert error', ins.error)
        }

        // Best-effort mirror to profiles.current_weight if column exists
        await supabase.from('profiles').update({ current_weight: wt } as any).eq('id', user.id)
      }

      setMsg({ kind: 'success', text: 'Saved your details.' })
      router.push('/profile')
    } catch (e: any) {
      console.error('Onboarding save error', e)
      setMsg({ kind: 'error', text: 'Something went wrong while saving.' })
    } finally {
      setSaving(false)
    }
  }

  // UI helpers
  const ChipEditor = ({
    label,
    hook,
    items,
    placeholder,
  }: {
    label: string
    hook: { val: string; setVal: (v: string) => void; add: () => void; onKeyDown: (e: any) => void; remove: (i: number) => void }
    items: string[]
    placeholder?: string
  }) => (
    <div className="chip-editor" style={{ marginTop: 10 }}>
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

  return (
    <div className="container ob-wrap">
      <h1 className="page-h1">Tell us about you</h1>

      {msg && (
        <div className={`banner ${msg.kind === 'error' ? 'error' : 'ok'}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

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
              <input className="pill-input" inputMode="decimal" placeholder="e.g., 175" value={height} onChange={e => setHeight(e.target.value)} />
            </div>
          </div>

          <div className="grid-3">
            <div>
              <label className="lbl">Current weight (kg)</label>
              <input className="pill-input" inputMode="decimal" placeholder="e.g., 82" value={currentWeight} onChange={e => setCurrentWeight(e.target.value)} />
            </div>
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

        <ChipEditor label="Allergies" hook={al} items={allergies} />
        <ChipEditor label="Dislikes" hook={dl} items={dislikes} />
        <ChipEditor label="Cuisine preferences" hook={cu} items={cuisines} />
      </section>

      {/* Exercise */}
      <section className="panel">
        <div className="panel-title">Exercise constraints</div>
        <ChipEditor label="Injuries" hook={ij} items={injuries} />
        <ChipEditor label="Health conditions" hook={hc} items={conditions} />
        <ChipEditor label="Equipment you have" hook={eq} items={equipment} placeholder="e.g., none, dumbbells, band" />
      </section>

      <div className="actions">
        <button className="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>

      {loading && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
    </div>
  )
}
