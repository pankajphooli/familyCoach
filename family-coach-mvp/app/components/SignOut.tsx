'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient'

export default function SignOut({ className = 'button-outline', children = 'Sign out' }){
  const router = useRouter()
  const supabase = createClient()

  const doSignOut = async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      try { localStorage.clear() } catch {}
      router.push('/auth')
      router.refresh()
    }
  }

  return (
    <button className={className} onClick={doSignOut}>
      {children}
    </button>
  )
}
