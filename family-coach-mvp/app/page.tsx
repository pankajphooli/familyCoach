
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabaseClient'

export default function Home(){
  const supabase = createClient()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { 
      setUser(data.user); 
      if (data.user) router.push('/onboarding')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        router.push('/onboarding')
      }
    })
    return () => { sub.subscription?.unsubscribe?.() }
  }, [])

  const signUp = async() => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if(error) { alert(error.message); return }
    const me = await supabase.auth.getUser()
    if (me.data.user) router.push('/onboarding')
    else alert('Check your email to confirm, then return — onboarding will start automatically.')
  }

  const signIn = async() => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if(error) alert(error.message)
    else {
      setUser(data.user)
      router.push('/onboarding')
    }
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
        <p>Family-centric diet & fitness planner. Create your profile, join/create your family, generate today&apos;s plan, and track progress.</p>
      </div>
    </div>
  )
}
