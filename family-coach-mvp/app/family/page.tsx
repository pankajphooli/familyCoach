'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

type Member = { id:string, user_id:string, role:string, can_manage_members:boolean, profiles?: any }
type Kid = { id:string, name:string, dob?: string | null }

export default function Family(){
  const supabase = createClient()
  const [family, setFamily] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [kids, setKids] = useState<Kid[]>([])
  const [invite, setInvite] = useState<string>('')
  const [familyName, setFamilyName] = useState<string>('')
  const [isOwner, setIsOwner] = useState<boolean>(false)
  const [inviteEmail, setInviteEmail] = useState('')

  const [kidName, setKidName] = useState('')
  const [kidDob, setKidDob] = useState<string>('')

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: prof } = await supabase.from('profiles').select('family_id, full_name').eq('id', user.id).maybeSingle()
    if (!prof?.family_id) { setFamily(null); setMembers([]); setKids([]); return }

    const { data: fam } = await supabase.from('families').select('*').eq('id', prof.family_id).maybeSingle()
    setFamily(fam || null)
    const owner = fam?.owner_user_id === user.id
    setIsOwner(owner)

    const { data: current } = await supabase.from('family_members').select('id').eq('family_id', prof.family_id).eq('user_id', user.id).maybeSingle()
    if (!current) {
      await supabase.from('family_members').insert({ family_id: prof.family_id, user_id: user.id, role: owner ? 'owner' : 'member', can_manage_members: owner })
    }

    const { data: memsRaw } = await supabase.from('family_members').select('id,user_id,role,can_manage_members,profiles:profiles(full_name)').eq('family_id', prof.family_id)
    const mems: any[] = (memsRaw as any[]) || []
    const normalized: Member[] = mems.map((m:any) => {
      const p = m.profiles; const full = Array.isArray(p) ? (p[0]?.full_name ?? null) : (p?.full_name ?? null)
      return { ...m, profiles: { full_name: full } }
    })
    setMembers(normalized)

    const { data: d } = await supabase.from('dependents').select('id,name,dob').eq('family_id', prof.family_id).order('name')
    setKids((d||[]) as Kid[])
  }

  useEffect(()=>{ load() }, [])

  const createFamily = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ if ((window as any).toast) (window as any).toast('error','Sign in first'); return }
    const invite_code = Math.random().toString(36).slice(2,8)
    const { data, error } = await supabase.from('families').insert({ name: familyName, owner_user_id: user.id, invite_code }).select().single()
    if(error) { if ((window as any).toast) (window as any).toast('error', error.message); return }
    await supabase.from('profiles').update({ family_id: data.id }).eq('id', user.id)
    await supabase.from('family_members').insert({ family_id: data.id, user_id: user.id, role: 'owner', can_manage_members: true })
    setFamilyName('')
    if ((window as any).toast) (window as any).toast('success','Family created. You are the owner 👑')
    await load()
  }

  const removeMember = async (id:string) => {
    if (!isOwner) { if ((window as any).toast) (window as any).toast('error','Only owner can remove'); return }
    const { error } = await supabase.from('family_members').delete().eq('id', id)
    if (error) { if ((window as any).toast) (window as any).toast('error', error.message) }
    else { if ((window as any).toast) (window as any).toast('success','Removed'); await load() }
  }

  const toggleManager = async (m:Member) => {
    if (!isOwner) { if ((window as any).toast) (window as any).toast('error','Owner only'); return }
    const { error } = await supabase.from('family_members').update({ can_manage_members: !m.can_manage_members }).eq('id', m.id)
    if (error) { if ((window as any).toast) (window as any).toast('error', error.message) }
    else { if ((window as any).toast) (window as any).toast('success','Updated'); await load() }
  }

  const regenInvite = async () => {
    if (!isOwner || !family) return
    const code = Math.random().toString(36).slice(2,8)
    const { error } = await supabase.from('families').update({ invite_code: code }).eq('id', family.id)
    if (error) { if ((window as any).toast) (window as any).toast('error', error.message) }
    else { if ((window as any).toast) (window as any).toast('success','New code minted'); await load() }
  }

  const joinWithCode = async () => {
    const { data: fam } = await supabase.from('families').select('*').eq('invite_code', invite).maybeSingle()
    if (!fam) { if ((window as any).toast) (window as any).toast('error','Invalid code'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ if ((window as any).toast) (window as any).toast('error','Sign in'); return }
    await supabase.from('family_members').insert({ family_id: fam.id, user_id: user.id, role: 'member' })
    await supabase.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
    setInvite('')
    if ((window as any).toast) (window as any).toast('success','Joined family 🎉'); await load()
  }

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !family) { if ((window as any).toast) (window as any).toast('error','Enter an email'); return }
    const res = await fetch('/api/invite', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), family_id: family.id })
    })
    const out = await res.json()
    if (!res.ok) { if ((window as any).toast) (window as any).toast('error', out.error || 'Invite failed'); return }
    setInviteEmail('')
    if ((window as any).toast) (window as any).toast('success','Invite sent ✉️')
  }

  const addKid = async () => {
    if (!family) return
    if (!kidName.trim()) { if ((window as any).toast) (window as any).toast('error','Enter a name'); return }
    const color = ['#60a5fa','#a78bfa','#34d399','#f472b6','#f59e0b','#22d3ee'][Math.floor(Math.random()*6)]
    const { error } = await supabase.from('dependents').insert({ family_id: family.id, name: kidName.trim(), dob: kidDob || null, color })
    if (error) { if ((window as any).toast) (window as any).toast('error', error.message); return }
    setKidName(''); setKidDob(''); if ((window as any).toast) (window as any).toast('success','Kid added 👶'); await load()
  }

  const removeKid = async (id:string) => {
    if (!isOwner) { if ((window as any).toast) (window as any).toast('error','Owner only'); return }
    const { error } = await supabase.from('dependents').delete().eq('id', id)
    if (error) { if ((window as any).toast) (window as any).toast('error', error.message) }
    else { if ((window as any).toast) (window as any).toast('success','Removed'); await load() }
  }

  return (
    <div className="grid">
      {!family && (
        <div className="card">
          <h2>Your Family</h2>
          <p>You&apos;re not in a family yet.</p>
          <div className="grid grid-2">
            <input className="input" placeholder="Family name" value={familyName} onChange={e=>setFamilyName(e.target.value)} />
            <button className="button" onClick={createFamily}>Create</button>
          </div>
          <hr/>
          <div className="grid grid-2">
            <input className="input" placeholder="Invite code" value={invite} onChange={e=>setInvite(e.target.value)} />
            <button className="button" onClick={joinWithCode}>Join</button>
          </div>
        </div>
      )}
      {family && (
        <div className="card">
          <h2>Family: {family.name}</h2>
          <p><b>Invite code:</b> {family.invite_code} {isOwner && <button className="button" onClick={regenInvite} style={{marginLeft:8}}>Regenerate</button>}</p>

          <div className="grid grid-2">
            <div className="card">
              <h3>Members</h3>
              <div className="grid">
                {members.length === 0 && <p className="muted">Adding you as owner…</p>}
                {members.map(m => (
                  <div key={m.id} className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <b>{m.profiles?.full_name || m.user_id.slice(0,6)}</b> <small className="muted">({m.role})</small>
                      {m.can_manage_members && <span className="badge" style={{marginLeft:8}}>manager</span>}
                    </div>
                    {isOwner && (
                      <div style={{display:'flex',gap:8}}>
                        <button className="button" onClick={()=>toggleManager(m)}>{m.can_manage_members ? 'Revoke manage' : 'Make manager'}</button>
                        {m.role !== 'owner' && <button className="button" onClick={()=>removeMember(m.id)}>Remove</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="grid grid-2" style={{marginTop:12}}>
                <input className="input" placeholder="Invite by email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} />
                <button className="button" onClick={sendInvite}>Send Invite</button>
              </div>
            </div>

            <div className="card">
              <h3>Kids (no email)</h3>
              <div className="grid grid-3">
                <input className="input" placeholder="Name" value={kidName} onChange={e=>setKidName(e.target.value)} />
                <input className="input" type="date" value={kidDob} onChange={e=>setKidDob(e.target.value)} />
                <button className="button" onClick={addKid}>Add</button>
              </div>
              <div className="grid" style={{marginTop:12}}>
                {kids.length===0 && <p className="muted">No kids added yet.</p>}
                {kids.map(k => (
                  <div key={k.id} className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div><b>{k.name}</b> {k.dob ? <small className="muted">({k.dob})</small> : null}</div>
                    {isOwner && <button className="button" onClick={()=>removeKid(k.id)}>Remove</button>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
