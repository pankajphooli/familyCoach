'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'

type Profile = {
  id: string
  full_name?: string | null
  family_id?: string | null
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

type Family = { id: string; name: string | null; invite_code: string | null }

export default function OnboardingPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [familyBusy, setFamilyBusy] = useState(false)
  const [needSignIn, setNeedSignIn] = useState(false)

  const [userId, setUserId] = useState<string>('')

  // Profile fields
  const [fullName, setFullName] = useState('')
  const [goalWeight, setGoalWeight] = useState<string>('') // keep as string for input
  const [goalDate, setGoalDate] = useState<string>('')

  const [dietaryPattern, setDietaryPattern] = useState<string>('') // veg | non_veg | etc
  const [meatPolicy, setMeatPolicy] = useState<string>('')          // non_veg_chicken_only | …
  const [allergies, setAllergies] = useState<string>('')            // comma-separated
  const [dislikes, setDislikes] = useState<string>('')
  const [cuisines, setCuisines] = useState<string>('')
  const [injuries, setInjuries] = useState<string>('')
  const [conditions, setConditions] = useState<string>('')          // health conditions
  const [equipment, setEquipment] = useState<string>('')

  // Family state
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string>('')
  const [familyCode, setFamilyCode] = useState<string>('') // current code (if you own/joined)
  const [joinCode, setJoinCode] = useState<string>('')     // input to join by code

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) {
      ;(window as any).toast(kind, msg)
    } else {
      kind === 'error' ? console.warn(msg) : console.log(msg)
    }
  }

  function splitCSV(s: string): string[] | null {
    const arr = (s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    return arr.length ? arr : null
  }

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setNeedSignIn(true); return }
        setUserId(user.id)

        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, family_id, goal_weight, goal_target_date, dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment')
          .eq('id', user.id)
          .maybeSingle()

        const p = (data || {}) as Profile
        setFullName(p.full_name || '')
        setGoalWeight(p.goal_weight != null ? String(p.goal_weight) : '')
        setGoalDate(p.goal_target_date || '')
        setDietaryPattern(p.dietary_pattern || '')
        setMeatPolicy(p.meat_policy || '')
        setAllergies((p.allergies || []).join(', '))
        setDislikes((p.dislikes || []).join(', '))
        setCuisines((p.cuisine_prefs || []).join(', '))
        setInjuries((p.injuries || []).join(', '))
        setConditions((p.health_conditions || []).join(', '))
        setEquipment((p.equipment || []).join(', '))

        if (p.family_id) {
          setFamilyId(p.family_id)
          const { data: fam } = await supabase
            .from('families')
            .select('id,name,invite_code')
            .eq('id', p.family_id)
            .maybeSingle()
          const f = (fam || null) as Family | null
          if (f) {
            setFamilyName(f.name || '')
            setFamilyCode((f.invite_code || '').toLowerCase())
          }
        }
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveProfile() {
    if (!userId) { notify('error', 'Sign in first'); return }
    setSaving(true)
    try {
      const payload: Partial<Profile> = {
        full_name: fullName || null,
        goal_weight: goalWeight ? Number(goalWeight) : null,
        goal_target_date: goalDate || null,
        dietary_pattern: dietaryPattern || null,
        meat_policy: meatPolicy || null,
        allergies: splitCSV(allergies),
        dislikes: splitCSV(dislikes),
        cuisine_prefs: splitCSV(cuisines),
        injuries: splitCSV(injuries),
        health_conditions: splitCSV(conditions),
        equipment: splitCSV(equipment),
      }
      const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
      if (error) throw error
      notify('success', 'Profile saved')
    } catch (e: any) {
      notify('error', e?.message || 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  function makeCode() {
    // 5-char lower-case (matches the rest of your app)
    return Math.random().toString(36).slice(2, 7).toLowerCase()
  }

  async function createFamily() {
    if (!userId) { notify('error', 'Sign in first'); return }
    if (!familyName.trim()) { notify('error', 'Enter a family name'); return }
    setFamilyBusy(true)
    try {
      let code = makeCode()
      for (let i = 0; i < 3; i++) {
        const { data: exists } = await supabase.from('families').select('id').eq('invite_code', code).maybeSingle()
        if (!exists) break
        code = makeCode()
      }

      const { data: fam, error } = await supabase
        .from('families')
        .insert({ name: familyName.trim(), invite_code: code })
        .select('id,name,invite_code')
        .maybeSingle()
      if (error) throw error
      if (!fam?.id) throw new Error('Could not create family')

      const up = await supabase.from('profiles').update({ family_id: fam.id }).eq('id', userId)
      if (up.error) throw up.error

      const ins = await supabase.from('family_members').insert({
        family_id: fam.id, user_id: userId, role: 'owner', can_manage_members: true,
      })
      if (ins.error) throw ins.error

      setFamilyId(fam.id)
      setFamilyCode((fam.invite_code || code).toLowerCase())
      notify('success', `Family created. Invite code: ${fam.invite_code || code}`)
    } catch (e: any) {
      notify('error', e?.message || 'Could not create family')
    } finally {
      setFamilyBusy(false)
    }
  }

  /** Join via server route (works even if RLS blocks reading families by invite_code) */
  async function joinFamily() {
    if (!userId) { notify('error', 'Sign in first'); return }
    const code = joinCode.trim().toLowerCase()
    if (!code) { notify('error', 'Enter the invite code'); return }

    setFamilyBusy(true)
    try {
      const res = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || 'Join failed')

      // update local state
      setFamilyId(j.family?.id || null)
      setFamilyName(j.family?.name || '')
      setFamilyCode(j.family?.invite_code || code)
      notify('success', 'Joined family')
    } catch (e: any) {
      notify('error', e?.message || 'Could not join family')
    } finally {
      setFamilyBusy(false)
    }
  }

  async function finish() {
    await saveProfile()
    router.push('/')
  }

  if (loading) {
    return (
      <div className="container" style={{ paddingBottom: 84 }}>
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <div className="muted">Loading…</div>
      </div>
    )
  }

  if (needSignIn) {
    return (
      <div className="container" style={{ paddingBottom: 84 }}>
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <div className="muted">Please sign in first.</div>
      </div>
    )
  }

  return (
    <div className="container" style={{ display: 'grid', gap: 16, paddingBottom: 84 }}>
      <h1 className="text-2xl font-semibold">Welcome 👋</h1>
      <div className="muted">Tell us about you and connect your family.</div>

      {/* Profile + Goals */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">Your profile & goals</h2>

        <label className="lbl">Full name</label>
        <input className="pill-input" placeholder="Your name" value={fullName} onChange={(e)=>setFullName(e.target.value)} />

        <div className="grid-3">
          <div>
            <div className="lbl">Goal weight</div>
            <input className="pill-input" inputMode="decimal" placeholder="e.g. 78" value={goalWeight} onChange={(e)=>setGoalWeight(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Target date</div>
            <input className="pill-input" type="date" value={goalDate||''} onChange={(e)=>setGoalDate(e.target.value)} />
          </div>
        </div>

        <div className="grid-3">
          <div>
            <div className="lbl">Dietary pattern</div>
            <select className="pill-input" value={dietaryPattern} onChange={(e)=>setDietaryPattern(e.target.value)}>
              <option value="">— select —</option>
              <option value="veg">Vegetarian</option>
              <option value="non_veg">Non-vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="omnivore">Omnivore</option>
            </select>
          </div>
          <div>
            <div className="lbl">Meat policy</div>
            <select className="pill-input" value={meatPolicy} onChange={(e)=>setMeatPolicy(e.target.value)}>
              <option value="">— select —</option>
              <option value="non_veg_chicken_only">Chicken only</option>
              <option value="non_veg">All meats</option>
              <option value="veg_only">No meat</option>
            </select>
          </div>
        </div>

        <div className="lbl">Allergies (comma separated)</div>
        <input className="pill-input" placeholder="e.g. peanuts, shellfish" value={allergies} onChange={(e)=>setAllergies(e.target.value)} />

        <div className="lbl">Dislikes (comma separated)</div>
        <input className="pill-input" placeholder="e.g. broccoli, okra" value={dislikes} onChange={(e)=>setDislikes(e.target.value)} />

        <div className="grid-3">
          <div>
            <div className="lbl">Preferred cuisines</div>
            <input className="pill-input" placeholder="e.g. Indian, Thai" value={cuisines} onChange={(e)=>setCuisines(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Injuries</div>
            <input className="pill-input" placeholder="e.g. knee pain" value={injuries} onChange={(e)=>setInjuries(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Health conditions</div>
            <input className="pill-input" placeholder="e.g. hypertension" value={conditions} onChange={(e)=>setConditions(e.target.value)} />
          </div>
        </div>

        <div className="lbl">Available equipment</div>
        <input className="pill-input" placeholder="e.g. resistance band, dumbbells" value={equipment} onChange={(e)=>setEquipment(e.target.value)} />

        <div className="actions">
          <button className="button" disabled={saving} onClick={saveProfile}>{saving ? 'Saving…' : 'Save profile'}</button>
        </div>
      </section>

      {/* Family */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">Your family</h2>

        {familyId ? (
          <div className="grid" style={{ gap: 6 }}>
            <div><span className="lbl">Family name:</span> {familyName || '—'}</div>
            <div><span className="lbl">Invite code:</span> <code>{familyCode || '—'}</code></div>
            <div className="muted">Share this code so others can join your family.</div>
          </div>
        ) : (
          <>
            <div className="lbl">Create a new family</div>
            <div className="grid" style={{ gap: 8 }}>
              <input className="pill-input" placeholder="Family name (e.g., Phooli Homies)" value={familyName} onChange={(e)=>setFamilyName(e.target.value)} />
              <button className="button" disabled={familyBusy} onClick={createFamily}>{familyBusy ? 'Creating…' : 'Create family'}</button>
            </div>

            <div className="lbl" style={{ marginTop: 10 }}>— or join with a code —</div>
            <div className="grid" style={{ gap: 8 }}>
              <input className="pill-input" placeholder="Invite code (e.g. pqg5a5)" value={joinCode} onChange={(e)=>setJoinCode(e.target.value)} autoCapitalize="off" autoCorrect="off" />
              <button className="button-outline" disabled={familyBusy} onClick={joinFamily}>{familyBusy ? 'Joining…' : 'Join family'}</button>
            </div>
          </>
        )}
      </section>

      {/* Finish */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">All set?</h2>
        <div className="muted">You can tweak anything later in Profile or Family.</div>
        <div className="actions">
          <button className="button" onClick={finish}>Finish onboarding</button>
        </div>
      </section>
    </div>
  )
}
