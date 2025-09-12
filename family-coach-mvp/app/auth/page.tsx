'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../lib/supabaseClient'

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [mode, setMode] = useState<Mode>('signup') // design shows Sign up selected
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectAfter = sp.get('redirect') || '/'

  async function ensureProfile(userId: string) {
    // Profiles in your DB typically exist; this just guarantees it without breaking if email column doesn't exist
    await supabase.from('profiles').upsert({ id: userId } as any, { onConflict: 'id' })
  }

  async function submit() {
    setBusy(true); setError(null)
    try {
      if (!email || !password) { setError('Enter email and password'); return }

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.user) throw new Error('No user returned')
        await ensureProfile(data.user.id)
        // New accounts → onboarding
        router.push('/onboarding')
        return
      }

      // Sign in
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (!data.user) throw new Error('No user returned')
      await ensureProfile(data.user.id)

      // Go back to the intended page (or home)
      router.push(redirectAfter || '/')
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 28, paddingBottom: 28 }}>
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 24, marginBottom: 28 }}>
        HouseholdHQ
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 24 }}>
        <button
          onClick={() => setMode('signin')}
          style={{
            background: 'transparent',
            fontWeight: 700,
            opacity: mode === 'signin' ? 1 : .42,
            borderBottom: mode === 'signin' ? '2px solid #000' : '2px solid transparent',
            paddingBottom: 4
          }}
        >
          Sign in
        </button>
        <button
          onClick={() => setMode('signup')}
          style={{
            background: 'transparent',
            fontWeight: 700,
            opacity: mode === 'signup' ? 1 : .42,
            borderBottom: mode === 'signup' ? '2px solid #000' : '2px solid transparent',
            paddingBottom: 4
          }}
        >
          Sign up
        </button>
      </div>

      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
        {mode === 'signup' ? 'Create an account' : 'Welcome back'}
      </div>
      <div style={{ textAlign: 'center', opacity: .72, marginBottom: 16 }}>
        {mode === 'signup'
          ? 'Enter your email to sign up for this app'
          : 'Enter your email to sign in'}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <input
          className="line-input"
          placeholder="email@domain.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          className="line-input"
          placeholder="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <button
          className="button"
          onClick={submit}
          disabled={busy}
          style={{ height: 46, marginTop: 6 }}
        >
          {busy ? 'Please wait…' : 'Continue'}
        </button>

        {error && <div className="muted" style={{ color: 'var(--danger, #b00020)' }}>{error}</div>}

        <div style={{ textAlign: 'center', fontSize: 12, opacity: .7, marginTop: 8 }}>
          By clicking continue, you agree to our <a className="link" href="#">Terms of Service</a> and <a className="link" href="#">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}
