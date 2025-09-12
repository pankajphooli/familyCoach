// app/auth/page.tsx
import { Suspense } from 'react'
import AuthForm from './AuthForm'

// Prevent static export issues; render on demand
export const dynamic = 'force-dynamic'

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 16 }}>Loading…</div>}>
      <AuthForm />
    </Suspense>
  )
}
