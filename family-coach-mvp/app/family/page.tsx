'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../lib/supabaseClient' // keep the capital C

type Family = { id: string; name: string | null; invite_code: string | null }
type Profile = { id: string; full_name: string | null; family_id?: string | null }
type Member = { user_id: string; name: string; role: 'owner' | 'member'; you: boolean }
type Kid = { id: string; name: string; dob: string }

export default function FamilyPage() {
  const supabase = useMemo(() => createClient(), [])
  const [busy, setBusy] = useState(false)

  const [me, setMe] = useState<Profile | null>(null)
  const [fam, setFam] = useState<Family | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [kids, setKids] = useState<Kid[]>([])

  // add-kid form
  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState('')
  const addBoxRef = useRef<HTMLDivElement | null>(null)

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else console[kind === 'error' ? 'warn' : 'log'](msg)
  }

  useEffect(() => {
    (async () => {
      setBusy(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { return }

        // my profile
        const profRes = await supabase
          .from('profiles')
          .select('id, full_name, family_id')
          .eq('id', user.id)
          .maybeSingle()
        const prof = (profRes.data || null) as Profile | null
        setMe(prof)

        if (!prof?.family_id) return

        // family
        const famRes = await supabase
          .from('families')
          .select('id, name, invite_code')
          .eq('id', prof.family_id)
          .maybeSingle()
        setFam((famRes.data || null) as Family | null)

        // adults (handle profiles as object OR array)
        const memRes = await supabase
          .from('family_members')
          .select('user_id, role, can_manage_members, profiles!inner(full_name)')
          .eq('family_id', prof.family_id)
          .order('role', { ascending: false })

        const memRows = (memRes.data as any[]) || []

        const nameFromProfiles = (p: any) =>
          Array.isArray(p) ? (p[0]?.full_name ?? 'Member') : (p?.full_name ?? 'Member')

        const mapped: Member[] = memRows.map((m: any) => ({
          user_id: m.user_id,
          name: nameFromProfiles(m.profiles),
          role: m.role as 'owner' | 'member',
          you: m.user_id === user.id
        }))
        setMembers(mapped)

        // kids
        const depRes = await supabase
          .from('dependents')
          .select('id,name,dob')
          .eq('family_id', prof.family_id)
          .order('name')
        setKids(((depRes.data || []) as any[]).map(r => ({ id: r.id, name: r.name, dob: r.dob })))
      } finally {
        setBusy(false)
      }
    })()
  }, [supabase])

  // ---- actions -------------------------------------------------------------

  function scrollToAdd() {
    addBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function regenerateCode() {
    if (!fam) return
    const code = Math.random().toString(36).slice(2, 7)
    setBusy(true)
    try {
      const res = await supabase
        .from('families')
        .update({ invite_code: code })
        .eq('id', fam.id)
        .select()
        .maybeSingle()
      if (res.error) throw res.error
      setFam({ ...fam, invite_code: res.data?.invite_code ?? code })
      notify('success', 'Invite code updated')
    } catch {
      notify('error', 'Could not regenerate the code')
    } finally { setBusy(false) }
  }

  async function addKid() {
    if (!fam) return
    if (!kidName.trim() || !kidDob) { notify('error', 'Enter name and DOB'); return }
    setBusy(true)
    try {
      const ins = await supabase
        .from('dependents')
        .insert({ family_id: fam.id, name: kidName.trim(), dob: kidDob })
        .select()
        .maybeSingle()
      if (ins.error) throw ins.error
      setKids([...kids, { id: ins.data!.id, name: ins.data!.name, dob: ins.data!.dob }])
      setKidName(''); setKidDob('')
      notify('success', 'Child added')
    } catch {
      notify('error', 'Could not add child')
    } finally { setBusy(false) }
  }

  async function removeKid(id: string) {
    setBusy(true)
    try {
      const del = await supabase.from('dependents').delete().eq('id', id)
      if (del.error) throw del.error
      setKids(kids.filter(k => k.id !== id))
      notify('success', 'Removed')
    } catch {
      notify('error', 'Could not remove')
    } finally { setBusy(false) }
  }

  async function removeAdult(user_id: string) {
    if (!fam) return
    setBusy(true)
    try {
      const del = await supabase
        .from('family_members')
        .delete()
        .eq('family_id', fam.id)
        .eq('user_id', user_id)
      if (del.error) throw del.error
      setMembers(members.filter(m => m.user_id !== user_id))
      notify('success', 'Member removed')
    } catch {
      notify('error', 'Could not remove member')
    } finally { setBusy(false) }
  }

  // ---- view ---------------------------------------------------------------

  if (!me) {
    return (
      <div className="container" style={{ display: 'grid', gap: 16 }}>
        <h1 className="text-3xl font-extrabold">Family</h1>
        <div className="muted">You’re not signed in. Sign in from the header.</div>
      </div>
    )
  }
  if (!fam) {
    return (
      <div className="container" style={{ display: 'grid', gap: 16 }}>
        <h1 className="text-3xl font-extrabold">Family</h1>
        <div className="muted">No family found yet. Create or join a family from onboarding.</div>
      </div>
    )
  }

  return (
    <div className="container" style={{ display: 'grid', gap: 16, paddingBottom: 84 }}>
      <h1 className="text-3xl font-extrabold">Family</h1>

      {/* Family name + Add Kids */}
      <div className="flex items-center justify-between">
        <div className="text-2xl font-extrabold">
          Family: <span className="font-extrabold">{fam.name || '—'}</span>
        </div>
        <button className="button" onClick={scrollToAdd}>Add Kids</button>
      </div>

      {/* Invite code row */}
      <div className="flex items-center justify-between">
        <div className="text-lg">
          <span className="font-semibold">Invite Code</span>&nbsp;
          <span className="font-mono tracking-wider">{fam.invite_code || '—'}</span>
        </div>
        <button className="button-outline" onClick={regenerateCode}>Regenerate</button>
      </div>

      {/* Members card */}
      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="text-xl font-extrabold">Members</div>

        <ul className="grid gap-3">
          {members.map((m, idx) => (
            <li key={m.user_id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="opacity-60">{idx + 1}.</span>
                <span className="font-bold">{m.name || 'Member'}</span>
                {m.role === 'owner' && <span className="chip">owner</span>}
                {m.you && <span className="chip">you</span>}
              </div>
              <button className="button-outline" onClick={() => removeAdult(m.user_id)}>Remove</button>
            </li>
          ))}

          {kids.map((k, j) => {
            const n = members.length + j + 1
            return (
              <li key={k.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="opacity-60">{n}.</span>
                  <span className="font-bold">{k.name}</span>
                  <span className="chip">child</span>
                  {k.dob && <span className="opacity-70">DOB {new Date(k.dob).toLocaleDateString()}</span>}
                </div>
                <button className="button-outline" onClick={() => removeKid(k.id)}>Remove</button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Add kid form */}
      <section ref={addBoxRef} className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="text-lg font-extrabold">Add Items</div>
        <input
          className="line-input"
          placeholder="Name"
          value={kidName}
          onChange={e => setKidName(e.target.value)}
        />
        <input
          className="line-input"
          placeholder="Dob"
          type="date"
          value={kidDob}
          onChange={e => setKidDob(e.target.value)}
        />
        <div className="flex justify-end">
          <button className="button" onClick={addKid}>Add</button>
        </div>
      </section>

      {busy && <div className="muted">Working…</div>}
    </div>
  )
}
