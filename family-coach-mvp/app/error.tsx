// app/error.tsx
'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Log to the browser console and to Vercel logs (server logs will capture console.error from client)
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('App error boundary:', error)
  }, [error])

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 12px' }}>Something went wrong</h2>
      <div style={{ background: '#fee', border: '1px solid #f99', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
        {error?.message || String(error)}
      </div>
      {error?.stack && (
        <details style={{ marginTop: 12 }}>
          <summary>Stack trace</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{error.stack}</pre>
        </details>
      )}
      <button
        onClick={() => reset()}
        style={{ marginTop: 16, padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  )
}
