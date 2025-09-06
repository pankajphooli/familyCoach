
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

export default function Family(){
  const supabase = createClient()
  const [name, setName] = useState('')
  const [invite, setInvite] = useState('')
  const [family, setFamily] = useState<any>(null)

  const createFamily = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in first'); return }
    const invite_code = Math.random().toString(36).slice(2,8)
    const { data, error } = await supabase.from('families').insert({ name, owner_user_id: user.id, invite_code }).select().single()
    if(error) alert(error.message); else {
      await supabase.from('family_members').insert({ family_id: data.id, user_id: user.id, role: 'owner' })
      setFamily(data)
    }
  }
  const joinFamily = async () => {
    const { data, error } = await supabase.from('families').select('id, name, invite_code').eq('invite_code', invite).maybeSingle()
    if(error || !data){ alert('Invalid code'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if(!user){ alert('Sign in'); return }
    const { error: e2 } = await supabase.from('family_members').insert({ family_id: data.id, user_id: user.id, role: 'member' })
    if(e2) alert(e2.message); else setFamily(data)
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Create Family</h2>
        <input className="input" placeholder="Family name" value={name} onChange={e=>setName(e.target.value)} />
        <button className="button" onClick={createFamily}>Create</button>
        {family && <p>Invite code: <b>{family.invite_code}</b></p>}
      </div>
      <div className="card">
        <h2>Join Family</h2>
        <input className="input" placeholder="Invite code" value={invite} onChange={e=>setInvite(e.target.value)} />
        <button className="button" onClick={joinFamily}>Join</button>
      </div>
    </div>
  )
}
