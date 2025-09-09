'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export default function MobileHeader({ title='HouseholdHQ' }: { title?: string }){
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Create Supabase client inline (no local import path headaches)
  const supabase = useMemo(() => {
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      console.warn('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }
    return createSupabaseClient(url || '', anon || '')
  }, [])

  async function onSignOut(){
    try{ await supabase.auth.signOut() }catch{}
    router.push('/')
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <header className="mobile-header">
      <button aria-label="Menu" onClick={()=>setOpen(v=>!v)} style={{display:'grid', placeItems:'center'}}>
        <span className="icon" aria-hidden>☰</span>
      </button>
      <div className="title">{title}</div>
      <div style={{width:22, height:22, borderRadius:999, background:'#ddd'}} aria-hidden />
      {open && (
        <div style={{position:'fixed', top:56, left:8, right:8, zIndex:45}}>
          <div className="card" style={{display:'grid', gap:8}}>
            <a href="/profile" className="button-outline">Profile</a>
            <a href="/family" className="button-outline">Family</a>
            <button className="button" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      )}
    </header>
  )
}
