'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '../lib/supabaseClient'
import { useEffect, useState } from 'react'

export default function TopNav(){
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const [uid, setUid] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user?.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id ?? null))
    return () => { sub.subscription.unsubscribe() }
  }, [])

  async function onSignOut(e: React.MouseEvent<HTMLButtonElement>){
    e.preventDefault()
    try{
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.replace('/')
      router.refresh()
    }catch(err:any){
      console.error('signOut error', err)
      alert('Sign-out failed: ' + (err?.message || String(err)))
    }
  }

  const linkCls = (href:string) => `px-3 py-2 rounded-md text-sm font-medium ${pathname===href?'underline':''}`

  return (
    <nav className="flex items-center justify-between py-3" style={{gap: 12}}>
      <div className="flex items-center" style={{gap: 8}}>
        <Link href="/" className="text-xl font-semibold">HouseholdHQ</Link>
        <Link href="/plans" className={linkCls('/plans')}>Plans</Link>
        <Link href="/calendar" className={linkCls('/calendar')}>Calendar</Link>
        <Link href="/grocery" className={linkCls('/grocery')}>Grocery</Link>
        <Link href="/family" className={linkCls('/family')}>Family</Link>
      </div>
      <div className="flex items-center" style={{gap: 8}}>
        {uid ? (
          <button type="button" onClick={onSignOut} className="button">Sign out</button>
        ) : (
          <Link href="/auth" className="button">Sign in</Link>
        )}
      </div>
    </nav>
  )
}
