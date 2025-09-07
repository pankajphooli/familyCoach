'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'

export default function HamburgerMenu(){
  const supabase = createClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return
      setUserEmail(data.user?.email ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user?.email ?? null)
    })
    // click outside to close
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
      document.removeEventListener('mousedown', onDoc)
    }
  }, [])

  async function onSignOut(e: React.MouseEvent<HTMLButtonElement>){
    e.preventDefault()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('signOut error', error)
      alert('Sign-out failed: ' + error.message)
      return
    }
    setOpen(false)
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="hamburger-wrap" ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Menu"
        className="icon-button"
        onClick={() => setOpen(v => !v)}
        title={userEmail || 'Menu'}
      >
        {/* simple hamburger icon */}
        <span style={{display:'block', width:18, height:2, background:'currentColor', marginBottom:4}}/>
        <span style={{display:'block', width:18, height:2, background:'currentColor', marginBottom:4}}/>
        <span style={{display:'block', width:18, height:2, background:'currentColor'}}/>
      </button>

      {open && (
        <div
          className="dropdown"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            minWidth: 180,
            padding: 8,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            border: '1px solid rgba(0,0,0,.08)',
            background: 'var(--card-bg, #fff)',
            zIndex: 40
          }}
        >
          <div style={{padding:'6px 8px', fontSize:12, opacity:.7}}>
            {userEmail || 'Signed out'}
          </div>
          <div style={{display:'grid', gap:6, paddingTop:6}}>
            <Link href="/profile" onClick={()=>setOpen(false)} className="menu-item">Profile</Link>
            <button className="menu-item" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}
