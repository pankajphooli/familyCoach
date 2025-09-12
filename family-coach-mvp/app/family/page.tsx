'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
import './family-ui.css'

type Family = { id: string; name: string | null; invite_code: string | null }
type ProfileLite = { id: string; full_name: string | null }
type MemberRow = {
  user_id: string
  role: 'owner' | 'member'
  can_manage_members: boolean
  profiles: ProfileLite | null
}
type Member = {
  user_id: string
  name: string
  role: 'owner' | 'member'
  can_manage_members: boolean
  isYou: boolean
}
type Dependent = { id: string; name: string; dob: string | null }

export default function FamilyPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [family, setFamily] = useState<Family | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [kids, setKids] = useState<Dependent[]>([])
  const [canManage, setCanManage] = useState(false)
  const [meId, setMeId] = useState<string>('')

  // add-kid form
  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState('')
  const addFormRef = useRef<HTMLDivElement>(null)

  function notify(kind: 'success' | 'error', msg: string) {
    (window as any)?.toast?.(kind, msg)
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        setMeId(user.id)

        // Load my profile (to find family_id)
        const prof = await supabase
          .from('profiles')
          .select('family_id, full_name')
          .eq('id', user.id)
          .maybeSingle()
        const famId = (prof.data as any)?.family_id || null
        if (!famId) { setLoading(false); return }

        // Load family
        const famRes = await supabase
          .from('families')
          .select('id, name, invite_code')
          .eq('id', famId)
          .maybeSingle()
        setFamily((famRes.data as Family) || null)

        // Load members (family_members join profiles)
        const memRes = await supabase
          .from('family_members')
          .select('user_id, role, can_manage_members, profiles:profiles(id,full_name)')
          .eq('family_id', famId)
          .order('role', { ascending: false })

        const myRow = (memRes.data || []).find((r: any) => r.user_id === user.id) as MemberRow | undefined
        setCanManage(!!myRow?.can_manage_members || myRow?.role === 'owner')

        const mapped: Member[] = (memRes.data || []).map((r: any) => ({
          user_id: r.user_id,
          name: (r.profiles?.full_name ?? 'Member'),
          role: r.role,
          can_manage_members: r.can_manage_members,
          isYou: r.user_id === user.id,
        }))
        setMembers(mapped)

        // Load dependents (kids)
        const dep = await supabase
          .from('dependents')
          .select('id,name,dob')
          .eq('family_id', famId)
          .order('name')
        setKids((dep.data as Dependent[]) || [])
      } finally {
        setLoading(false)
      }
    })()
  }, [supabase])

  // ----- actions -----

  async function onRegenerate() {
    if (!family) return
    const code = Math.random().toString(36).slice(2, 7).toLowerCase()
    const up = await supabase.from('families').update({ invite_code: code }).eq('id', family.id)
    if (up.error) { notify('error', up.error.message); return }
    setFamily({ ...family, invite_code: code })
    notify('success', 'Invite code regenerated')
  }

  function scrollToAddKid() {
    addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function onRemoveMember(user_id: string) {
    if (!family) return
    if (!canManage) { notify('error', 'You don’t have permission'); return }
    const del = await supabase.from('family_members')
      .delete()
      .eq('family_id', family.id)
      .eq('user_id', user_id)
    if (del.error) { notify('error', del.error.message); return }
    setMembers(members.filter(m => m.user_id !== user_id))
    notify('success', 'Member removed')
  }

  async function onRemoveKid(id: string) {
    const del = await supabase.from('dependents').delete().eq('id', id)
    if (del.error) { notify('error', del.error.message); return }
    setKids(kids.filter(k => k.id !== id))
    notify('success', 'Removed')
  }

  async function onAddKid() {
    if (!family) return
    const name = kidName.trim()
    if (!name) { notify('error', 'Enter a name'); return }
    const ins = await supabase.from('dependents').insert({ family_id: family.id, name, dob: kidDob || null }).select('id,name,dob').single()
    if (ins.error) { notify('error', ins.error.message); return }
    setKids([...(kids || []), ins.data as Dependent])
    setKidName(''); setKidDob('')
    notify('success', 'Child added')
  }

  // ------------- RENDER -------------

  if (loading) {
    return <div className="container"><div className="muted">Loading…</div></div>
  }

  // If no family yet, fall back to whatever empty state you already had.
  if (!family) {
    return (
      <div className="container">
        <h1 className="page-h1">Family</h1>
        <div className="muted">No family found yet — create or join a family from onboarding.</div>
      </div>
    )
  }

  return (
    <div className="container fam-wrap">
      <h1 className="page-h1">Family</h1>

      {/* Title + Add Kids */}
      <div className="fam-head">
        <div className="fam-title">Family: <span className="bold">{family.name || '—'}</span></div>
        <button className="btn" onClick={scrollToAddKid}>Add Kids</button>
      </div>

      {/* Invite code row */}
      <div className="invite-row">
        <div className="invite-label">Invite Code</div>
        <div className="invite-code">{family.invite_code || '—'}</div>
        <button className="btn" onClick={onRegenerate}>Regenerate</button>
      </div>

      {/* Members panel */}
      <section className="panel">
        <div className="panel-title">Members</div>

        <ol className="mem-list">
          {members.map((m, idx) => (
            <li key={m.user_id} className="mem-row">
              <div className="mem-left">
                <div className="mem-name">{idx + 1}. {m.name}</div>
                <div className="mem-tags">
                  {m.role === 'owner' && <span className="mem-tag plain">owner</span>}
                  {m.isYou && <span className="mem-tag plain">you</span>}
                </div>
              </div>
              {canManage && (
                <button className="btn-outline sm" onClick={() => onRemoveMember(m.user_id)}>Remove</button>
              )}
            </li>
          ))}

          {kids.map((k, idx) => (
            <li key={k.id} className="mem-row">
              <div className="mem-left">
                <div className="mem-name">{members.length + idx + 1}. {k.name}</div>
                <div className="mem-tags">
                  <span className="mem-tag plain">child</span>
                  {k.dob && <span className="mem-tag plain">DOB {new Date(k.dob).toLocaleDateString()}</span>}
                </div>
              </div>
              {canManage && (
                <button className="btn-outline sm" onClick={() => onRemoveKid(k.id)}>Remove</button>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Add Items (kids) */}
      <section ref={addFormRef} className="panel">
        <div className="panel-title">Add Kids</div>
        <div className="form-grid">
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
        </div>
        <div className="actions">
          <button className="btn" onClick={onAddKid}>Add</button>
        </div>
      </section>
    </div>
  )
}
