'use client'

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { useCallback, useMemo } from 'react'

export default function ProfilePage(){
  const supabase = useMemo(()=>createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
  ), [])

  const onSignOut = useCallback(async()=>{
    await supabase.auth.signOut()
    // force full reload to clear any stale UI state
    if (typeof window !== 'undefined') window.location.href = '/'
  }, [supabase])

  return (
    <div className="container" style={{paddingBottom:80, display:'grid', gap:16}}>
      <h1 className="text-2xl font-semibold">Profile</h1>

      <div className="card" style={{display:'grid', gap:8}}>
        <Link className="link" href="/profile/details">Your details</Link>
        <Link className="link" href="/family">Family</Link>
      </div>

      <button className="button-outline" onClick={onSignOut}>Sign out</button>
    </div>
  )
}
