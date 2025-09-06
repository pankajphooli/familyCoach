
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

export default function Home(){
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setLoading(false) })
  }, [])

  const signUp = async() => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    alert(error ? error.message : 'Check your email to confirm. Then sign in.')
  }
  const signIn = async() => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if(error) alert(error.message)
    else setUser(data.user)
  }
  const signOut = async() => { await supabase.auth.signOut(); setUser(null) }

  return (
    <div className="grid" style={{gap:16}}>
      <div className="card">
        <h2>Welcome {user ? user.email : ''}</h2>
        {!user && (
          <div className="grid grid-2">
            <input className="input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button className="button" onClick={signIn}>Sign in</button>
            <button className="button" onClick={signUp}>Sign up</button>
          </div>
        )}
        {user && <button className="button" onClick={signOut}>Sign out</button>}
      </div>
      <div className="card">
        <h3>What is this?</h3>
        <p>Family-centric diet & fitness planner. Create your profile, join your family, generate today&apos;s diet & workout plan, and track progress.</p>
      </div>
    </div>
  )
}
