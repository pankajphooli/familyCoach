'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type MemberRow = {
  user_id: string
  role: 'owner' | 'member'
  can_manage_members: boolean | null
}
type Profile = { id: string; full_name: string | null }
type Kid = { id: string; name: string; dob: string | null }

function fmtDOB(d?: string | null) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString() } catch { return String(d) }
}
function tag(txt: string) {
  return (
    <span
      style={{
        marginLeft: 8,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid var(--card-border)',
        fontSize: 12,
        opacity: 0.8,
      }}
    >
      {txt}
    </span>
  )
}
function randomInvite(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

export default function FamilyPage() {
  const supabase = useMemo(() => createClient(), [])
  const addBoxRef = useRef<HTMLDivElement | null>(null)

  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<{ id: string; full_name: string | null } | null>(null)

  const [familyId, setFamilyId] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string>('—')
  const [invite, setInvite] = useState<string>('')

  const [members, setMembers] = useState<
    Array<{ user_id: string; full_name: string | null; role: string; isYou: boolean }>
  >([])
  const [kids, setKids] = useState<Kid[]>([])

  // Add-kid form
  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState('')

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else kind === 'error' ? console.warn(msg) : console.log(msg)
  }

  useEffect(() => {
    ;(async () => {
      setBusy(true)
      try {
        const { data: auth } = await supabase.auth.getUser()
        const user = auth?.user
        if (!user) {
          notify('error', 'Please sign in')
          setBusy(false)
          return
        }

        // Me (profile) → family
        const prof = await supabase.from('profiles').select('id, full_name, family_id').eq('id', user.id).maybeSingle()
        const myProf = (prof.data as any) || null
        setMe({ id: user.id, full_name: myProf?.full_name || null })

        const fid = myProf?.family_id || null
        setFamilyId(fid)

        if (!fid) {
          setFamilyName('No family yet')
          setInvite('')
          setMembers([])
          setKids([])
          setBusy(false)
          return
        }

        // Family record
        const fam = await supabase.from('families').select('name, invite_code').eq('id', fid).maybeSingle()
        setFamilyName((fam.data as any)?.name || 'Family')
        setInvite((fam.data as any)?.invite_code || '')

        // Members
        const fmRes = await supabase
          .from('family_members')
          .select('user_id, role, can_manage_members')
          .eq('family_id', fid)

        const rows: MemberRow[] = (fmRes.data as any) || []
        const userIds = rows.map((r) => r.user_id)
        const profs = userIds.length
          ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
          : { data: [] as Profile[] }

        const byId = new Map<string, Profile>()
        ;((profs.data as Profile[]) || []).forEach((p) => byId.set(p.id, p))

        const combined = rows.map((r) => ({
          user_id: r.user_id,
          full_name: byId.get(r.user_id)?.full_name ?? null,
          role: r.role,
          isYou: r.user_id === user.id,
        }))
        // Owner first, then others; stable display
        combined.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.full_name?.localeCompare(b.full_name || '') || 0))
        setMembers(combined)

        // Kids
        const kd = await supabase.from('dependents').select('id, name, dob').eq('family_id', fid).order('name', { ascending: true })
        setKids((kd.data as Kid[]) || [])
      } finally {
        setBusy(false)
      }
    })()
  }, [supabase])

  async function onRegenerate() {
    if (!familyId) return
    const code = randomInvite()
    const { error } = await supabase.from('families').update({ invite_code: code }).eq('id', familyId)
    if (!error) {
      setInvite(code)
      notify('success', 'Invite code regenerated')
    } else notify('error', 'Could not regenerate invite code')
  }

  function scrollToAdd() {
    addBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function onAddKid() {
    if (!kidName.trim()) {
      notify('error', 'Please enter a name')
      return
    }
    if (!familyId) return
    const payload: any = { family_id: familyId, name: kidName.trim() }
    if (kidDob) payload.dob = kidDob
    const { data, error } = await supabase.from('dependents').insert(payload).select('id, name, dob').maybeSingle()
    if (error) {
      notify('error', 'Could not add child')
      return
    }
    setKids((k) => [...k, (data as any) as Kid].sort((a, b) => a.name.localeCompare(b.name)))
    setKidName('')
    setKidDob('')
    notify('success', 'Child added')
  }

  async function removeMember(uid: string, isKid = false) {
    if (!familyId) return
    if (isKid) {
      const { error } = await supabase.from('dependents').delete().eq('id', uid)
      if (!error) {
        setKids((k) => k.filter((x) => x.id !== uid))
        notify('success', 'Removed')
      } else notify('error', 'Could not remove item')
      return
    }
    const { error } = await supabase.from('family_members').delete().eq('family_id', familyId).eq('user_id', uid)
    if (!error) {
      setMembers((m) => m.filter((x) => x.user_id !== uid))
      notify('success', 'Removed')
    } else notify('error', 'Could not remove member')
  }

  return (
    <div className="container" style={{ paddingBottom: 84, display: 'grid', gap: 14 }}>
      <h1 className="text-2xl font-semibold">Family</h1>

      {/* Title row: Family: <name> + Add Kids */}
      <div className="flex items-center justify-between">
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          Family: <span style={{ fontWeight: 800 }}>{familyName}</span>
        </div>
        <button className="button" onClick={scrollToAdd}>Add Kids</button>
      </div>

      {/* Invite code + regenerate */}
      <div className="flex items-center" style={{ gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Invite Code</div>
        <div style={{ letterSpacing: 2 }}>{invite || '—'}</div>
        <button className="button" onClick={onRegenerate}>Regenerate</button>
      </div>

      {/* Members panel */}
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 800 }}>Members</div>

        <div style={{ display: 'grid', gap: 8 }}>
          {members.map((m, idx) => (
            <div key={m.user_id} className="row flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--card-border)' }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <div style={{ width: 22, textAlign: 'right', opacity: 0.7 }}>{idx + 1}.</div>
                <div style={{ fontWeight: 800 }}>{m.full_name || 'Member'}</div>
                {m.role === 'owner' && tag('owner')}
                {m.isYou && tag('you')}
              </div>
              <button className="button-outline" onClick={() => removeMember(m.user_id, false)}>Remove</button>
            </div>
          ))}

          {kids.map((k) => (
            <div key={k.id} className="row flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--card-border)' }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <div style={{ width: 22, textAlign: 'right', opacity: 0.7 }}>•</div>
                <div style={{ fontWeight: 800 }}>{k.name}</div>
                {tag('child')}
                {k.dob && <span style={{ marginLeft: 6, opacity: 0.7 }}>DOB {fmtDOB(k.dob)}</span>}
              </div>
              <button className="button-outline" onClick={() => removeMember(k.id, true)}>Remove</button>
            </div>
          ))}

          {(!members.length && !kids.length) && (
            <div className="muted">No members found yet.</div>
          )}
        </div>
      </div>

      {/* Add Items (kids) */}
      <div ref={addBoxRef} className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Add Items</div>
        <input
          className="line-input"
          placeholder="Name"
          value={kidName}
          onChange={(e) => setKidName(e.target.value)}
        />
        <input
          className="line-input"
          placeholder="Dob"
          type="date"
          value={kidDob}
          onChange={(e) => setKidDob(e.target.value)}
        />
        <div className="flex" style={{ justifyContent: 'flex-end' }}>
          <button className="button" onClick={onAddKid}>Add</button>
        </div>
      </div>

      {busy && <div className="muted">Refreshing…</div>}
    </div>
  )
}
