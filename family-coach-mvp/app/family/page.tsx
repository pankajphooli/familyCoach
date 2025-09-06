'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Member = { id:string, user_id:string, role:string, can_manage_members:boolean, profiles?: any }

export default function Family(){
  const supabase = createClient()
  const [family, setFamily] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invite, setInvite] = useState<string>('')
  const [name, setName] = useState<string>('')
  const [isOwner, setIsOwner] = useState<boolean>(false)

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    const { data: prof } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if (!prof?.family_id) { setFamily(null); setMembers([]); return }

    const { data: fam } = await supabase.from('families').select('*').eq('id', prof.family_id).maybeSingle()
    setFamily(fam || null)
    setIsOwner(fam?.owner_user_id === user.id)

    const { data: mems } = await supabase.from('family_members').select('id,user_id,role,can_manage_members,profiles:profiles(full_name)').eq('family_id', prof.family_id)
    setMembers((mems || []) as any[])
  }

  useEffect(()=>{ load() }, [])

  const createFamily = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    const invite_code = Math.random().toString(36).slice(2,8)
    const { data, error } = await supabase.from('families').insert({ name, owner_user_id: user.id, invite_code }).select().single()
    if(error) alert(error.message); else {
      await supabase.from('family_members').insert({ family_id: data.id, user_id: user.id, role: 'owner', can_manage_members: true })
      setName('')
      await load()
    }
  }

  const removeMember = async (id:string) => {
    if (!isOwner) { alert('Only the owner can remove'); return }
    const { error } = await supabase.from('family_members').delete().eq('id', id)
    if (error) alert(error.message); else await load()
  }

  const toggleManager = async (m:Member) => {
    if (!isOwner) { alert('Only the owner can change permissions'); return }
    const { error } = await supabase.from('family_members').update({ can_manage_members: !m.can_manage_members }).eq('id', m.id)
    if (error) alert(error.message); else await load()
  }

  const regenInvite = async () => {
    if (!isOwner || !family) return
    const code = Math.random().toString(36).slice(2,8)
    const { error } = await supabase.from('families').update({ invite_code: code }).eq('id', family.id)
    if (error) alert(error.message); else await load()
  }

  const joinWithCode = async () => {
    const { data: fam, error } = await supabase.from('families').select('*').eq('invite_code', invite).maybeSingle()
    if (error || !fam) { alert('Invalid code'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in'); return }
    await supabase.from('family_members').insert({ family_id: fam.id, user_id: user.id, role: 'member' })
    await supabase.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
    setInvite('')
    await load()
  }

  return (
    <div className="grid">
      {!family && (
        <div className="card">
          <h2>Your Family</h2>
          <p>You&apos;re not in a family yet.</p>
          <div className="grid grid-2">
            <input className="input" placeholder="Family name" value={name} onChange={e=>setName(e.target.value)} />
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
          <h3>Members</h3>
          <div className="grid">
            {members.map(m => (
              <div key={m.id} className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <b>{m.profiles?.full_name || m.user_id.slice(0,6)}</b> <small className="muted">({m.role})</small>
                  {m.can_manage_members && <span className="badge" style={{marginLeft:8}}>manager</span>}
                </div>
                <div style={{display:'flex',gap:8}}>
                  {isOwner && (
                    <>
                      <button className="button" onClick={()=>toggleManager(m)}>{m.can_manage_members ? 'Revoke manage' : 'Make manager'}</button>
                      {m.role !== 'owner' && <button className="button" onClick={()=>removeMember(m.id)}>Remove</button>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
