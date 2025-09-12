'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient' // <-- NOTE: lowercase "c" to match your repo

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('signup') // your design shows Sign up selected
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const redirectTo = searchParams?.get('redirectTo') || '/'

  useEffect(() => {
    // If already signed in, bounce back to redirectTo/home
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) router.replace(redirectTo)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function ensureProfile(userId: string) {
    // Safe upsert without assuming optional columns
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
        // return to intended page (middleware sets redirectTo)
        router.replace(redirectTo || '/')
        router.refresh()
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.user) {
          // Some projects require email confirm; still navigate to onboarding
          router.replace('/onboarding')
          return
        }
        await ensureProfile(data.user.id)
        // New users go straight to onboarding
        router.replace('/onboarding')
      }

      // Clear any local caches
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

  return (
    <div className="container" style={{ maxWidth: 420, marginInline: 'auto', padding: 16 }}>
      {/* Brand */}
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 24, margin: '32px 0' }}>
        HouseholdHQ
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setMode('signin')}
          style={{
            border: 'none',
            background: 'none',
            fontWeight: mode === 'signin' ? 800 : 600,
            opacity: mode === 'signin' ? 1 : .45,
            textDecoration: mode === 'signin' ? 'underline' : 'none',
            cursor: 'pointer'
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          style={{
            border: 'none',
            background: 'none',
            fontWeight: mode === 'signup' ? 800 : 600,
            opacity: mode === 'signup' ? 1 : .45,
            textDecoration: mode === 'signup' ? 'underline' : 'none',
            cursor: 'pointer'
          }}
        >
          Sign up
        </button>
      </div>

      {/* Headline */}
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
        {mode === 'signup' ? 'Create an account' : 'Welcome back'}
      </div>
      <div style={{ textAlign: 'center', color: 'var(--muted)', marginBottom: 18 }}>
        {mode === 'signup' ? 'Enter your email to sign up for this app' : 'Enter your email to sign in'}
      </div>

      {/* Form */}
      <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
        <input
          type="email"
          required
          placeholder="email@domain.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="line-input"
          style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--card-border)' }}
        />
        <input
          type="password"
          required
          placeholder="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="line-input"
          style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--card-border)' }}
        />

        {err && <div style={{ color: '#b00020', fontSize: 14 }}>{err}</div>}

        <button
          type="submit"
          disabled={busy}
          className="button"
          style={{ padding: '12px 14px', borderRadius: 12, fontWeight: 800, background: '#000', color: '#fff', opacity: busy ? .7 : 1 }}
        >
          {busy ? 'Please wait…' : 'Continue'}
        </button>

        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
          By clicking continue, you agree to our <u>Terms of Service</u> and <u>Privacy Policy</u>
        </div>
      </form>
    </div>
  )
}
