'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'

type ProfileRow = {
  id: string
  full_name?: string | null
  family_id?: string | null
  goal_weight?: number | null
  goal_target_date?: string | null
}

type FamilyRow = {
  id: string
  name: string | null
  invite_code: string | null
}

export default function OnboardingPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyFamily, setBusyFamily] = useState(false)

  const [needSignIn, setNeedSignIn] = useState(false)
  const [userId, setUserId] = useState<string>('')

  // Profile basics / goals
  const [fullName, setFullName] = useState('')
  const [goalWeight, setGoalWeight] = useState<string>('') // keep as string for input
  const [goalDate, setGoalDate] = useState<string>('')

  // Family
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string>('')
  const [familyCode, setFamilyCode] = useState<string>('') // current family’s invite code (if any)
  const [joinCode, setJoinCode] = useState<string>('')     // input for joining by code

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) {
      ;(window as any).toast(kind, msg)
    } else {
      kind === 'error' ? console.warn(msg) : console.log(msg)
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setNeedSignIn(true); return }
        setUserId(user.id)

        const { data: prof } = await supabase
          .from('profiles')
          .select('id, full_name, family_id, goal_weight, goal_target_date')
          .eq('id', user.id)
          .maybeSingle()

        const p = (prof || {}) as ProfileRow
        setFullName(p.full_name || '')
        setGoalWeight(p.goal_weight != null ? String(p.goal_weight) : '')
        setGoalDate(p.goal_target_date || '')

        if (p.family_id) {
          setFamilyId(p.family_id)
          const { data: fam } = await supabase
            .from('families')
            .select('id,name,invite_code')
            .eq('id', p.family_id)
            .maybeSingle()
          const f = fam as FamilyRow | null
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

  async function saveGoals() {
    if (!userId) { notify('error', 'Sign in first'); return }
    setSaving(true)
    try {
      const payload: Partial<ProfileRow> = {
        full_name: fullName || null,
        goal_weight: goalWeight ? Number(goalWeight) : null,
        goal_target_date: goalDate || null,
      }
      const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
      if (error) throw error
      notify('success', 'Goals saved')
    } catch (e: any) {
      notify('error', e?.message || 'Could not save goals')
    } finally {
      setSaving(false)
    }
  }

  function makeCode() {
    // 5-char lowercase alphanumeric
    return Math.random().toString(36).slice(2, 7).toLowerCase()
  }

  async function createFamily() {
    if (!userId) { notify('error', 'Sign in first'); return }
    if (!familyName.trim()) { notify('error', 'Enter a family name'); return }
    setBusyFamily(true)
    try {
      // ensure unique code (few retries)
      let code = makeCode()
      for (let i = 0; i < 3; i++) {
        const { data: exists } = await supabase
          .from('families')
          .select('id')
          .eq('invite_code', code)
          .maybeSingle()
        if (!exists) break
        code = makeCode()
      }

      const { data: fam, error } = await supabase
        .from('families')
        .insert({ name: familyName.trim(), invite_code: code })
        .select('id, name, invite_code')
        .maybeSingle()
      if (error) throw error
      if (!fam?.id) throw new Error('Could not create family')

      // attach user
      const up1 = await supabase.from('profiles').update({ family_id: fam.id }).eq('id', userId)
      if (up1.error) throw up1.error

      const ins = await supabase.from('family_members').insert({
        family_id: fam.id, user_id: userId, role: 'owner', can_manage_members: true,
      })
      if (ins.error) throw ins.error

      setFamilyId(fam.id)
      setFamilyName(fam.name || familyName)
      setFamilyCode((fam.invite_code || code).toLowerCase())
      notify('success', `Family created. Invite code: ${fam.invite_code || code}`)
    } catch (e: any) {
      notify('error', e?.message || 'Could not create family')
    } finally {
      setBusyFamily(false)
    }
  }

  async function joinFamily() {
    if (!userId) { notify('error', 'Sign in first'); return }
    const code = joinCode.trim().toLowerCase()
    if (!code) { notify('error', 'Enter the invite code'); return }
    setBusyFamily(true)
    try {
      const { data: fam, error } = await supabase
        .from('families')
        .select('id,name,invite_code')
        .ilike('invite_code', code) // case-insensitive
        .maybeSingle()
      if (error) throw error
      if (!fam?.id) throw new Error('Invalid code')

      const up1 = await supabase.from('profiles').update({ family_id: fam.id }).eq('id', userId)
      if (up1.error) throw up1.error

      const ins = await supabase.from('family_members').insert({
        family_id: fam.id, user_id: userId, role: 'member', can_manage_members: false,
      })
      if (ins.error) {
        // ignore unique violation if user already a member
        const msg = String(ins.error.message || '').toLowerCase()
        if (!msg.includes('duplicate')) throw ins.error
      }

      setFamilyId(fam.id)
      setFamilyName(fam.name || '')
      setFamilyCode((fam.invite_code || '').toLowerCase())
      notify('success', 'Joined family')
    } catch (e: any) {
      notify('error', e?.message || 'Could not join family')
    } finally {
      setBusyFamily(false)
    }
  }

  async function finishOnboarding() {
    // Save goals (if the user forgot) then go home
    await saveGoals()
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
      <div className="muted">Let’s set your goals and connect your family.</div>

      {/* Goals */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">Your goals</h2>

        <label className="lbl">Your name</label>
        <input
          className="pill-input"
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <div className="grid-3">
          <div>
            <div className="lbl">Goal weight</div>
            <input
              className="pill-input"
              inputMode="decimal"
              placeholder="e.g. 78"
              value={goalWeight}
              onChange={(e) => setGoalWeight(e.target.value)}
            />
          </div>
          <div>
            <div className="lbl">Target date</div>
            <input
              className="pill-input"
              type="date"
              value={goalDate || ''}
              onChange={(e) => setGoalDate(e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button disabled={saving} className="button" onClick={saveGoals}>
            {saving ? 'Saving…' : 'Save goals'}
          </button>
        </div>
      </section>

      {/* Family */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">Your family</h2>

        {familyId ? (
          <div className="grid" style={{ gap: 6 }}>
            <div><span className="lbl">Family name:</span> {familyName || '—'}</div>
            <div><span className="lbl">Invite code:</span> <code>{familyCode || '—'}</code></div>
            <div className="muted">Share this code with your family members so they can join.</div>
          </div>
        ) : (
          <>
            <div className="lbl">Create a new family</div>
            <div className="grid" style={{ gap: 8 }}>
              <input
                className="pill-input"
                placeholder="Family name (e.g., Phooli Homies)"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
              />
              <button disabled={busyFamily} className="button" onClick={createFamily}>
                {busyFamily ? 'Creating…' : 'Create family'}
              </button>
            </div>

            <div className="lbl" style={{ marginTop: 10 }}>— or join with a code —</div>
            <div className="grid" style={{ gap: 8 }}>
              <input
                className="pill-input"
                placeholder="Invite code (e.g. pqg5a5)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button disabled={busyFamily} className="button-outline" onClick={joinFamily}>
                {busyFamily ? 'Joining…' : 'Join family'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Finish */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="text-xl font-medium">All set?</h2>
        <div className="muted">You can change any of this later in Profile or Family.</div>
        <div className="actions">
          <button className="button" onClick={finishOnboarding}>Finish onboarding</button>
        </div>
      </section>
    </div>
  )
}
