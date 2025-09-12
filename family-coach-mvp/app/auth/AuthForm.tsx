'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseclient' // ← change to 'supabaseClient' if your file uses a capital C

type Mode = 'signin' | 'signup'

export default function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const redirectTo = searchParams?.get('redirectTo') || '/'

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) router.replace(redirectTo)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function ensureProfile(userId: string) {
    await supabase.from('profiles').upsert({ id: userId } as any, { onConflict: 'id' })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      if (!email || !password) throw new Error('Enter email and password')

      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        if (!data.user) throw new Error('No user returned')
        await ensureProfile(data.user.id)
        router.replace(redirectTo || '/')
        router.refresh()
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.user) await ensureProfile(data.user.id)
        router.replace('/onboarding')
      }

      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('plans_cache_')) localStorage.removeItem(k)
        })
      } catch {}
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // ---- styles tuned to your design ----
  const cardBorder = 'rgba(0,0,0,.1)'
  const muted = 'rgba(0,0,0,.55)'

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '28px 16px 40px' }}>
      {/* Brand */}
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 28, margin: '18px 0 28px' }}>
        HouseholdHQ
      </div>

      {/* Tabs row (centered, underline on active, inactive muted) */}
      <div style={{ display:'flex', gap:22, justifyContent:'center', alignItems:'center', margin:'6px 0 26px' }}>
        <button
          type="button"
          onClick={()=>setMode('signin')}
          style={{
            background:'none', border:'none', cursor:'pointer',
            fontSize:16, fontWeight: mode==='signin'?800:600,
            color: mode==='signin'?'#000':muted, padding:'0 2px',
            textDecoration: mode==='signin'?'underline':'none', textUnderlineOffset: 6
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={()=>setMode('signup')}
          style={{
            background:'none', border:'none', cursor:'pointer',
            fontSize:16, fontWeight: mode==='signup'?800:600,
            color: mode==='signup'?'#000':muted, padding:'0 2px',
            textDecoration: mode==='signup'?'underline':'none', textUnderlineOffset: 6
          }}
        >
          Sign up
        </button>
      </div>

      {/* Headline + helper text */}
      <div style={{ textAlign:'center', fontWeight:800, fontSize:18, marginBottom:8 }}>
        {mode==='signup' ? 'Create an account' : 'Welcome back'}
      </div>
      <div style={{ textAlign:'center', color: muted, marginBottom:16 }}>
        {mode==='signup' ? 'Enter your email to sign up for this app' : 'Enter your email to sign in'}
      </div>

      {/* Form */}
      <form onSubmit={onSubmit} style={{ display:'grid', gap:12 }}>
        <input
          type="email"
          required
          placeholder="email@domain.com"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          style={{
            height:48, padding:'0 14px', borderRadius:12,
            border:`1px solid ${cardBorder}`, background:'#fff', fontSize:16
          }}
        />
        <input
          type="password"
          required
          placeholder="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          style={{
            height:48, padding:'0 14px', borderRadius:12,
            border:`1px solid ${cardBorder}`, background:'#fff', fontSize:16
          }}
        />

        {err && <div style={{ color:'#b00020', fontSize:14 }}>{err}</div>}

        <button
          type="submit"
          disabled={busy}
          style={{
            height:48, borderRadius:14, border:'none', cursor:'pointer',
            background:'#000', color:'#fff', fontWeight:800, fontSize:16,
            opacity: busy ? .75 : 1
          }}
        >
          {busy ? 'Please wait…' : 'Continue'}
        </button>

        <div style={{ textAlign:'center', color: muted, fontSize:12, marginTop:8 }}>
          By clicking continue, you agree to our <u>Terms of Service</u> and <u>Privacy Policy</u>
        </div>
      </form>
    </div>
  )
}
