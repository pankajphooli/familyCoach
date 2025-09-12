'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient' // adjust casing if needed

type Member = {
  user_id: string
  name: string
  role: 'owner' | 'member'
  can_manage_members: boolean
  isYou?: boolean
}
type Dependent = { id: string; name: string; dob: string | null }

export default function FamilyPage(){
  const supabase = useMemo(()=>createClient(), [])
  const [loading, setLoading] = useState(true)
  const [needSignIn, setNeedSignIn] = useState(false)
  const [userId, setUserId] = useState<string>('')

  const [familyId, setFamilyId] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string>('')
  const [inviteCode, setInviteCode] = useState<string>('')

  const [members, setMembers] = useState<Member[]>([])
  const [kids, setKids] = useState<Dependent[]>([])

  // create/join inputs
  const [newFamilyName, setNewFamilyName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinErr, setJoinErr] = useState<string>('')

  // add-kid inputs
  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState('')

  const [busyCreate, setBusyCreate] = useState(false)
  const [busyJoin, setBusyJoin] = useState(false)
  const [busyKid, setBusyKid] = useState(false)

  function toast(kind:'success'|'error'|'info', msg:string){
    (window as any)?.toast ? (window as any).toast(kind, msg) : (kind==='error' ? console.warn(msg) : console.log(msg))
  }

  function nameFromProfiles(p: any): string {
    if (!p) return 'Member'
    if (Array.isArray(p)) return p[0]?.full_name ?? 'Member'
    return p.full_name ?? 'Member'
  }

  async function load(){
    setLoading(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ setNeedSignIn(true); return }
      setUserId(user.id)

      // your profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, full_name, family_id')
        .eq('id', user.id)
        .maybeSingle()

      const famId = (prof as any)?.family_id ?? null
      setFamilyId(famId)

      if(famId){
        // family basic
        const { data: fam } = await supabase
          .from('families')
          .select('id,name,invite_code')
          .eq('id', famId)
          .maybeSingle()
        if(fam){
          setFamilyName((fam as any).name || '')
          setInviteCode(String((fam as any).invite_code || '').toLowerCase())
        }

        // members
        const memRes = await supabase
          .from('family_members')
          .select('user_id, role, can_manage_members, profiles(full_name)')
          .eq('family_id', famId)
          .order('role', { ascending: false })
        const rows = (memRes.data || []) as any[]
        const enriched: Member[] = rows.map(r=>({
          user_id: r.user_id,
          role: r.role,
          can_manage_members: !!r.can_manage_members,
          name: nameFromProfiles(r.profiles),
          isYou: r.user_id === user.id
        }))
        setMembers(enriched)

        // kids
        const depRes = await supabase
          .from('dependents')
          .select('id,name,dob')
          .eq('family_id', famId)
          .order('name')
        setKids(((depRes.data || []) as any[]).map(r=>({ id: r.id, name: r.name, dob: r.dob })))
      } else {
        setMembers([])
        setKids([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{ load() }, []) // eslint-disable-line

  function makeCode(){ return Math.random().toString(36).slice(2,7).toLowerCase() }

  async function onCreateFamily(){
    if(!userId){ toast('error','Sign in first'); return }
    if(!newFamilyName.trim()){ toast('error','Enter a family name'); return }
    setBusyCreate(true)
    try{
      // unique-ish code
      let code = makeCode()
      for(let i=0;i<3;i++){
        const { data: exists } = await supabase.from('families').select('id').eq('invite_code', code).maybeSingle()
        if(!exists) break
        code = makeCode()
      }

      const { data: fam, error } = await supabase
        .from('families')
        .insert({ name: newFamilyName.trim(), invite_code: code })
        .select('id,name,invite_code')
        .maybeSingle()
      if(error) throw error
      if(!fam?.id) throw new Error('Could not create family')

      const up = await supabase.from('profiles').update({ family_id: fam.id }).eq('id', userId)
      if(up.error) throw up.error

      const ins = await supabase.from('family_members').insert({
        family_id: fam.id, user_id: userId, role:'owner', can_manage_members: true
      })
      if(ins.error) throw ins.error

      toast('success','Family created')
      setNewFamilyName('')
      await load()
    }catch(e:any){
      toast('error', e?.message || 'Could not create family')
    }finally{
      setBusyCreate(false)
    }
  }

async function onJoinFamily(){
  setJoinErr('')
  const code = joinCode.trim().toLowerCase()
  if (!code) { setJoinErr('Enter the invite code'); return }

  try {
    // must be signed in
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setJoinErr('Please sign in first'); return }

    // look up family by code via RPC (bypasses RLS safely)
    const { data: fam, error: rpcErr } = await supabase
      .rpc('lookup_family_by_code', { p_code: code })
      .single()

    if (rpcErr) { setJoinErr(`Lookup failed: ${rpcErr.message}`); return }
    if (!fam?.id) { setJoinErr('Invalid code'); return }

    // link profile to family (RLS: update your own profile)
    const up = await supabase
      .from('profiles')
      .update({ family_id: fam.id })
      .eq('id', user.id)
    if (up.error) { setJoinErr(`Link failed: ${up.error.message}`); return }

    // ensure membership row (ignore duplicate)
    const ins = await supabase
      .from('family_members')
      .insert({ family_id: fam.id, user_id: user.id, role:'member', can_manage_members:false })
    if (ins.error) {
      const msg = String(ins.error.message || '').toLowerCase()
      if (!msg.includes('duplicate')) { setJoinErr(`Membership failed: ${ins.error.message}`); return }
    }

    (window as any)?.toast?.('success','Joined family')
    setJoinCode('')
    await load()
  } catch (e:any) {
    setJoinErr(e?.message || 'Network error while joining')
  }
}

  async function onAddKid(){
    if(!familyId){ toast('error','Create or join a family first'); return }
    if(!kidName.trim()){ toast('error','Enter a child name'); return }
    setBusyKid(true)
    try{
      const ins = await supabase
        .from('dependents')
        .insert({ family_id: familyId, name: kidName.trim(), dob: kidDob || null })
        .select('id,name,dob')
        .maybeSingle()
      if(ins.error) throw ins.error
      setKidName(''); setKidDob('')
      toast('success','Child added')
      await load()
    }catch(e:any){
      toast('error', e?.message || 'Could not add child')
    }finally{
      setBusyKid(false)
    }
  }

  if(loading){
    return <div className="container"><div className="muted">Loading…</div></div>
  }
  if(needSignIn){
    return <div className="container"><div className="muted">Please sign in to manage your family.</div></div>
  }

  return (
    <div className="container" style={{ display:'grid', gap:14, paddingBottom:84 }}>
      <h1 className="text-2xl font-semibold">Family</h1>

      {!familyId && (
        <>
          <section className="card" style={{ display:'grid', gap:12 }}>
            <h2 className="text-xl font-medium">Start a family</h2>
            <input
              className="pill-input"
              placeholder="Family name (e.g., Phooli Homies)"
              value={newFamilyName}
              onChange={e=>setNewFamilyName(e.target.value)}
            />
            <div className="actions">
              <button className="button" disabled={busyCreate} onClick={onCreateFamily}>
                {busyCreate ? 'Creating…' : 'Create family'}
              </button>
            </div>
          </section>

          <section className="card" style={{ display:'grid', gap:12 }}>
            <h2 className="text-xl font-medium">Join with an invite code</h2>
            <input
              className="pill-input"
              placeholder="Invite code (e.g. pqg5a5)"
              value={joinCode}
              onChange={e=>setJoinCode(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {joinErr ? <div className="muted" style={{ color:'var(--danger, #b00020)' }}>{joinErr}</div> : null}
            <div className="actions">
              <button className="button-outline" disabled={busyJoin} onClick={onJoinFamily}>
                {busyJoin ? 'Joining…' : 'Join family'}
              </button>
            </div>
          </section>
        </>
      )}

      {familyId && (
        <>
          <section className="card" style={{ display:'grid', gap:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div>
                <div className="lbl">Family</div>
                <div style={{ fontWeight:800, fontSize:18 }}>{familyName || '—'}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div className="lbl">Invite code</div>
                <code>{inviteCode || '—'}</code>
              </div>
            </div>
          </section>

          <section className="card" style={{ display:'grid', gap:10 }}>
            <h2 className="text-xl font-medium">Members</h2>
            {members.length === 0 && <div className="muted">No members yet.</div>}
            {members.length > 0 && (
              <ul className="grid" style={{ gap:10 }}>
                {members.map(m=>(
                  <li key={m.user_id} className="ev-row" style={{ gridTemplateColumns:'1fr auto' }}>
                    <div className="ev-title" style={{ fontSize:18 }}>
                      {m.name} {m.isYou ? <span className="muted">· you</span> : null}
                    </div>
                    <div className="ev-time" style={{ alignSelf:'center' }}>
                      <span className="muted">{m.role === 'owner' ? 'owner' : 'member'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" style={{ display:'grid', gap:10 }}>
            <h2 className="text-xl font-medium">Children (no email)</h2>
            <div style={{ display:'flex', gap:8 }}>
              <input className="pill-input" placeholder="Child name" value={kidName} onChange={e=>setKidName(e.target.value)} />
              <input className="pill-input" type="date" value={kidDob} onChange={e=>setKidDob(e.target.value)} />
              <button className="button-outline" disabled={busyKid} onClick={onAddKid}>
                {busyKid ? 'Adding…' : 'Add'}
              </button>
            </div>

            {kids.length > 0 && (
              <ul className="grid" style={{ gap:8 }}>
                {kids.map(k=>(
                  <li key={k.id}>• {k.name} {k.dob ? <span className="muted">— {k.dob}</span> : null}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
