'use client'

import { useEffect, useMemo, useState } from 'react'
import './family-ui.css'

// IMPORTANT: adjust the casing to match your repo:
// If your file is /lib/supabaseclient.ts (lowercase c):
import { createClient } from '../../lib/supabaseClient'
// If it's /lib/supabaseClient.ts (capital C), use:
// import { createClient } from '../../lib/supabaseClient'

type Family = { id: string; name: string | null; code?: string | null; invite_code?: string | null; join_code?: string | null }
type ProfileLite = { full_name: string | null }
type MemberRow = { user_id: string; role: 'owner'|'member'; can_manage_members?: boolean|null; profiles?: ProfileLite | ProfileLite[] | null }
type Dependent = { id: string; name: string; dob: string|null }

export default function FamilyPreview(){
  const supabase = useMemo(()=>createClient(), [])
  const [loading, setLoading]   = useState(true)
  const [meId, setMeId]         = useState('')
  const [family, setFamily]     = useState<Family|null>(null)
  const [members, setMembers]   = useState<MemberRow[]>([])
  const [kids, setKids]         = useState<Dependent[]>([])

  useEffect(()=>{ (async()=>{
    setLoading(true)
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ setLoading(false); return }
    setMeId(user.id)

    // Find family id (prefer membership → fallback profile)
    let famId: string | null = null
    const fm = await supabase.from('family_members').select('family_id').eq('user_id', user.id).limit(1).maybeSingle()
    famId = (fm.data as any)?.family_id || null
    if(!famId){
      const pr = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
      famId = (pr.data as any)?.family_id || null
    }
    if(!famId){ setLoading(false); return }

    // Family
    const f = await supabase.from('families').select('id,name,code,invite_code,join_code').eq('id', famId).maybeSingle()
    setFamily((f.data as Family) || null)

    // Members (read-only)
    const mem = await supabase
      .from('family_members')
      .select('user_id, role, can_manage_members, profiles(full_name)')
      .eq('family_id', famId)
      .order('role', { ascending:false })
    setMembers(((mem.data as any[])||[]))

    // Kids
    const dep = await supabase.from('dependents').select('id,name,dob').eq('family_id', famId).order('name')
    setKids(((dep.data as any[])||[]) as Dependent[])

    setLoading(false)
  })() }, [supabase])

  const codeValue = (f:Family|null) => f?.invite_code || f?.code || f?.join_code || '—'
  const nameOf = (m:MemberRow) => {
    const p = m.profiles
    if(!p) return '—'
    return Array.isArray(p) ? (p[0]?.full_name ?? '—') : (p.full_name ?? '—')
  }

  if(loading){
    return <div className="container"><div className="muted">Loading family…</div></div>
  }

  if(!family){
    return (
      <div className="container">
        <h1 className="page-h1">Family</h1>
        <div className="muted">No family found. Complete onboarding or join a family.</div>
      </div>
    )
  }

  return (
    <div className="container">
      <h1 className="page-h1">Family</h1>

      {/* Header row */}
      <div className="fam-row">
        <div className="fam-title">Family: <span className="fam-name">{family.name || '—'}</span></div>
        <button className="btn btn-dark" disabled title="Preview page — actions disabled">Add Kids</button>
      </div>

      {/* Invite row */}
      <div className="invite-row">
        <div className="invite-label">Invite Code</div>
        <div className="invite-code">{codeValue(family)}</div>
        <button className="btn btn-dark" disabled title="Preview page — actions disabled">Regenerate</button>
      </div>

      {/* Members */}
      <section className="panel">
        <div className="panel-title">Members</div>
        <ol className="members">
          {members.map((m, idx)=>(
            <li key={m.user_id} className="member-row">
              <div className="member-left">
                <span className="m-index">{idx+1}.</span>
                <span className="m-name">{nameOf(m)}</span>
                <span className="m-tags">
                  {m.role==='owner' && <span className="tag">(owner)</span>}
                  {m.user_id===meId && <span className="tag">(you)</span>}
                </span>
              </div>
              <div className="member-right">
                <button className="btn btn-outline sm" disabled title="Preview page — actions disabled">Remove</button>
              </div>
            </li>
          ))}
          {kids.map((k, idx)=>(
            <li key={k.id} className="member-row">
              <div className="member-left">
                <span className="m-index">{members.length+idx+1}.</span>
                <span className="m-name">{k.name}</span>
                <span className="m-tags">
                  <span className="tag">(child)</span>
                  {k.dob && <span className="dob"> DOB {new Date(k.dob).toLocaleDateString()}</span>}
                </span>
              </div>
              <div className="member-right">
                <button className="btn btn-outline sm" disabled title="Preview page — actions disabled">Remove</button>
              </div>
            </li>
          ))}
          {members.length===0 && kids.length===0 && <li className="muted">No members yet.</li>}
        </ol>
      </section>

      {/* Add Items (disabled in preview) */}
      <section className="panel">
        <div className="panel-title">Add Kids</div>
        <div className="add-grid">
          <div className="field"><input className="line-input" placeholder="Name" disabled /></div>
          <div className="field"><input className="line-input" placeholder="Dob" type="date" disabled /></div>
          <div className="actions right">
            <button className="btn btn-dark" disabled title="Preview page — actions disabled">Add</button>
          </div>
        </div>
      </section>
    </div>
  )
}
