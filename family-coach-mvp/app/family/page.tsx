'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import '../family/family-ui.css'
import { createClient } from '../../lib/supabaseClient'

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

  // ------- helpers -------
  async function findFamilyId(userId: string): Promise<string | null> {
    // 1) prefer family_members (less likely to be blocked by profile policies)
    const fm = await supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if ((fm.data as any)?.family_id) return (fm.data as any).family_id as string

    // 2) fallback to own profile
    const pr = await supabase
      .from('profiles')
      .select('family_id')
      .eq('id', userId)
      .maybeSingle()
    const fid = (pr.data as any)?.family_id || null
    return fid
  }

  async function ensureOwnerMembership(userId: string, familyId: string) {
    // If the membership row is missing, try to insert owner
    const exists = await supabase
      .from('family_members')
      .select('user_id')
      .eq('user_id', userId)
      .eq('family_id', familyId)
      .maybeSingle()
    if (!exists.data) {
      await supabase
        .from('family_members')
        .insert({ family_id: familyId, user_id: userId, role: 'owner', can_manage_members: true } as any)
        .select()
        .maybeSingle()
        .catch(() => {})
    }
  }

  function codeValue(f: Family | null) {
    return f?.invite_code || f?.code || f?.join_code || '—'
  }

  const canManage = (() => {
    const mine = members.find((m) => m.user_id === meId)
    return (mine?.role === 'owner') || !!mine?.can_manage_members
  })()

  // ------- load -------
  useEffect(() => {
    ;(async () => {
      setLoading(true)

      const { data: auth } = await supabase.auth.getUser()
      const user = auth.user
      if (!user) {
        setLoading(false)
        return
      }
      setMeId(user.id)

      let famId = await findFamilyId(user.id)

      // heal: if profile has family_id but membership missing, create it
      if (famId) {
        await ensureOwnerMembership(user.id, famId)
      }

      // try again from family_members after healing
      if (!famId) famId = await findFamilyId(user.id)

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

      // members (normalize profiles array->object)
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
          ? (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles)
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

  // ------- actions -------
  async function onRegenerate() {
    if (!fam) return
    if (!canManage) return notify('error', 'Only owner can regenerate')
    const newCode = Math.random().toString(36).slice(2, 7)
    const { error } = await supabase.from('families').update({ code: newCode }).eq('id', fam.id)
    if (error) return notify('error', 'Could not regenerate')
    setFam({ ...fam, code: newCode })
    notify('success', 'Invite code updated')
  }

  async function onRemoveAdult(uid: string) {
    if (!fam) return
    if (!canManage) return notify('error', 'You do not have permission')
    const isOwner = members.some((m) => m.user_id === uid && m.role === 'owner')
    if (uid === meId && isOwner) return notify('error', 'Owner cannot remove themselves')
    const { error } = await supabase
      .from('family_members')
      .delete()
      .eq('family_id', fam.id)
      .eq('user_id', uid)
    if (error) return notify('error', 'Remove failed')
    setMembers((prev) => prev.filter((m) => m.user_id !== uid))
  }

  async function onRemoveKid(id: string) {
    if (!fam) return
    if (!canManage) return notify('error', 'You do not have permission')
    const { error } = await supabase.from('dependents').delete().eq('id', id).eq('family_id', fam.id)
    if (error) return notify('error', 'Remove failed')
    setKids((prev) => prev.filter((k) => k.id !== id))
  }

  async function onAddKid() {
    if (!fam) return
    if (!canManage) return notify('error', 'You do not have permission')
    const name = kidName.trim()
    if (!name) return notify('error', 'Enter a name')
    const ins = await supabase
      .from('dependents')
      .insert({ family_id: fam.id, name, dob: kidDob || null })
      .select('id,name,dob')
      .maybeSingle()
    if (ins.error) return notify('error', 'Add failed')
    setKids((prev) => [...prev, (ins.data as Dependent)])
    setKidName('')
    setKidDob('')
    notify('success', 'Child added')
  }

  // ------- UI -------
  if (loading) {
    return (
      <div className="container"><div className="muted">Loading family…</div></div>
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

  const manage = canManage

  return (
    <div className="container">
      <h1 className="page-h1">Family</h1>

      <div className="fam-row">
        <div className="fam-title">
          Family: <span className="fam-name">{fam.name || '—'}</span>
        </div>
        <button
          className="btn btn-dark"
          onClick={() => addCardRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          Add Kids
        </button>
      </div>

      <div className="invite-row">
        <div className="invite-label">Invite Code</div>
        <div className="invite-code">{codeValue(fam)}</div>
        {manage && (
          <button className="btn btn-dark" onClick={onRegenerate}>
            Regenerate
          </button>
        )}
      </div>

      <section className="panel">
        <div className="panel-title">Members</div>
        <ol className="members">
          {members.map((m, idx) => (
            <li key={m.user_id} className="member-row">
              <div className="member-left">
                <span className="m-index">{idx + 1}.</span>
                <span className="m-name">{m.profiles?.full_name || '—'}</span>
                <span className="m-tags">
                  {m.role === 'owner' && <span className="tag">(owner)</span>}
                  {m.user_id === meId && <span className="tag">(you)</span>}
                </span>
              </div>
              <div className="member-right">
                {manage && (
                  <button className="btn btn-outline sm" onClick={() => onRemoveAdult(m.user_id)}>
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
                  {k.dob && <span className="dob"> DOB {new Date(k.dob).toLocaleDateString()}</span>}
                </span>
              </div>
              <div className="member-right">
                {manage && (
                  <button className="btn btn-outline sm" onClick={() => onRemoveKid(k.id)}>
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
            <button className="btn btn-dark" onClick={onAddKid}>Add</button>
          </div>
        </div>
      </section>
    </div>
  )
}
