'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabaseClient'
export default function TopNav(){
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string|undefined>()
  useEffect(()=>{ supabase.auth.getUser().then(({data})=> setUserEmail(data.user?.email)) },[])
  const signOut = async()=>{ await supabase.auth.signOut(); window.location.href='/' }
  return (<header style={{display:'flex',alignItems:'center',gap:16, padding:'10px 14px', borderBottom:'1px solid rgba(0,0,0,.08)'}}>
    <a href="/" style={{fontWeight:700}}>HouseholdHQ</a>
    <nav style={{display:'flex',gap:14,flexWrap:'wrap'}}>
      <a href="/plans">Plans</a><a href="/family">Family</a><a href="/calendar">Calendar</a><a href="/grocery">Grocery</a><a href="/profile">Profile</a><a href="/admin/errors" style={{opacity:.7}}>Errors</a>
    </nav>
    <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
      {userEmail && <small className="muted">{userEmail}</small>}
      <button className="button" onClick={signOut}>Sign out</button>
    </div>
  </header>)
}