'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import '../family/family-ui.css'
import { createClient } from '../lib/supabaseClient'

type Family = {
  id: string
  name: string | null
  code?: string | null
  invite_code?: string | null
  join_code?: string | null
}

type ProfileLite = { full_name: string | null }
type Member = {
  user_id: string
  role: 'owner' | 'member'
  can_manage_members?: boolean | null
  profiles?: ProfileLite | null
}
type Dependent = { id: string; name: string; dob: string | null }

export default function FamilyPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)

  const [fam, setFam] = useState<Family | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [kids, setKids] = useState<Dependent[]>([])
  const [meId, setMeId] = useState<string>('')

  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState('')

  const addCardRef = useRef<HTMLDivElement | null>(null)

  const notify = (kind: 'success' | 'error', msg: string) => {
    if (typeof window !== 'undefined' && (window as any).toast)
      (window as any).toast(kind, msg)
    else (kind === 'error' ? console.warn : console.log)(msg)
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      setMeId(user.id)

      // find family id
      let famId: string | undefined
      const p = await supabase
        .from('profiles')
        .select('family_id')
        .eq('id', user.id)
        .maybeSingle()
      famId = (p.data as any)?.family_id || undefined

      if (!famId) {
        const fm = await supabase
          .from('family_members')
          .select('family_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle()
        famId = (fm.data as any)?.family_id || undefined
      }
      if (!famId) {
        setLoading(false)
        return
      }

      // family
      const f = await supabase
        .from('families')
        .select('id,name,code,invite_code,join_code')
        .eq('id', famId)
        .maybeSingle()
      setFam((f.data as Family) || null)

      // members (normalize profiles to object, not array)
      const mem = await supabase
        .from('family_members')
        .select('user_id, role, can_manage_members, profiles(full_name)')
        .eq('family_id', famId)
        .order('role', { ascending: false })

      const normalized: Member[] = ((mem.data as any[]) || []).map((r) => ({
        user_id: r.user_id,
        role: r.role,
        can_manage_members: r.can_manage_members ?? null,
        profiles: r?.profiles
          ? Array.isArray(r.profiles)
            ? (r.profiles[0] as ProfileLite)
            : (r.profiles as ProfileLite)
          : null,
      }))
      setMembers(normalized)

      // kids
      const dep = await supabase
        .from('dependents')
        .select('id,name,dob')
        .eq('family_id', famId)
        .order('name')
      setKids(((dep.data as any[]) || []) as Dependent[])

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const codeValue = (f: Family | null) =>
    f?.invite_code || f?.code || f?.join_code || '—'

  const canManage = (() => {
    const mine = members.find((m) => m.user_id === meId)
    return (mine?.role === 'owner') || !!mine?.can_manage_members
  })()

  async function onRegenerate() {
    if (!fam) return
    if (!canManage) {
      notify('error', 'Only owner can regenerate')
      return
    }
    const newCode = Math.random().toString(36).slice(2, 7)
    const { error } = await supabase
      .from('families')
      .update({ code: newCode })
      .eq('id', fam.id)
    if (error) {
      notify('error', 'Could not regenerate')
      return
    }
    setFam({ ...fam, code: newCode })
    notify('success', 'Invite code updated')
  }

  async function onRemoveAdult(uid: string) {
    if (!fam) return
    if (!canManage) {
      notify('error', 'You do not have permission')
      return
    }
    const isOwner = members.some((m) => m.user_id === uid && m.role === 'owner')
    if (uid === meId && isOwner) {
      notify('error', 'Owner cannot remove themselves')
      return
    }
    const { error } = await supabase
      .from('family_members')
      .delete()
      .eq('family_id', fam.id)
      .eq('user_id', uid)
    if (error) {
      notify('error', 'Remove failed')
      return
    }
    setMembers(members.filter((m) => m.user_id !== uid))
  }

  async function onRemoveKid(id: string) {
    if (!fam) return
    if (!canManage) {
      notify('error', 'You do not have permission')
      return
    }
    const { error } = await supabase
      .from('dependents')
      .delete()
      .eq('id', id)
      .eq('family_id', fam.id)
    if (error) {
      notify('error', 'Remove failed')
      return
    }
    setKids(kids.filter((k) => k.id !== id))
  }

  async function onAddKid() {
    if (!fam) return
    if (!canManage) {
      notify('error', 'You do not have permission')
      return
    }
    const name = kidName.trim()
    if (!name) {
      notify('error', 'Enter a name')
      return
    }
    const { data, error } = await supabase
      .from('dependents')
      .insert({ family_id: fam.id, name, dob: kidDob || null })
      .select('id,name,dob')
      .maybeSingle()
    if (error) {
      notify('error', 'Add failed')
      return
    }
    setKids([...(kids || []), (data as Dependent)])
    setKidName('')
    setKidDob('')
    notify('success', 'Child added')
  }

  function roleTags(m: Member) {
    const tags: string[] = []
    if (m.role === 'owner') tags.push('owner')
    if (m.user_id === meId) tags.push('you')
    return tags
  }

  if (loading) {
    return (
      <div className="container">
        <div className="muted">Loading family…</div>
      </div>
    )
  }

  if (!fam) {
    return (
      <div className="container">
        <h1 className="page-h1">Family</h1>
        <div className="muted">
          No family found yet. Create or join a family from onboarding.
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <h1 className="page-h1">Family</h1>

      {/* Title + Add Kids */}
      <div className="fam-row">
        <div className="fam-title">
          Family: <span className="fam-name">{fam.name || '—'}</span>
        </div>
        <button
          className="btn btn-dark"
          onClick={() =>
            addCardRef.current?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          Add Kids
        </button>
      </div>

      {/* Invite code */}
      <div className="invite-row">
        <div className="invite-label">Invite Code</div>
        <div className="invite-code">{codeValue(fam)}</div>
        <button className="btn btn-dark" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>

      {/* Members card */}
      <section className="panel">
        <div className="panel-title">Members</div>
        <ol className="members">
          {members.map((m, idx) => (
            <li key={m.user_id} className="member-row">
              <div className="member-left">
                <span className="m-index">{idx + 1}.</span>
                <span className="m-name">{m.profiles?.full_name || '—'}</span>
                <span className="m-tags">
                  {roleTags(m).map((t) => (
                    <span key={t} className="tag">
                      ({t})
                    </span>
                  ))}
                </span>
              </div>
              <div className="member-right">
                {canManage && (
                  <button
                    className="btn btn-outline sm"
                    onClick={() => onRemoveAdult(m.user_id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}

          {kids.map((k, idx) => (
            <li key={k.id} className="member-row">
              <div className="member-left">
                <span className="m-index">{members.length + idx + 1}.</span>
                <span className="m-name">{k.name}</span>
                <span className="m-tags">
                  <span className="tag">(child)</span>
                  {k.dob ? (
                    <span className="dob">
                      {' '}
                      DOB {new Date(k.dob).toLocaleDateString()}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="member-right">
                {canManage && (
                  <button
                    className="btn btn-outline sm"
                    onClick={() => onRemoveKid(k.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}

          {members.length === 0 && kids.length === 0 && (
            <li className="muted">No members yet.</li>
          )}
        </ol>
      </section>

      {/* Add Items */}
      <section ref={addCardRef} className="panel">
        <div className="panel-title">Add Items</div>
        <div className="add-grid">
          <div className="field">
            <input
              className="line-input"
              placeholder="Name"
              value={kidName}
              onChange={(e) => setKidName(e.target.value)}
            />
          </div>
          <div className="field">
            <input
              className="line-input"
              placeholder="Dob"
              type="date"
              value={kidDob}
              onChange={(e) => setKidDob(e.target.value)}
            />
          </div>
          <div className="actions right">
            <button className="btn btn-dark" onClick={onAddKid}>
              Add
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
