// app/global-error.tsx
'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Global error boundary:', error)
  }, [error])

  // Global error boundaries must include <html> and <body>
  return (
    <html>
      <body>
        <div style={{ padding: 16, maxWidth: 760, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ margin: '0 0 12px' }}>App crashed</h2>
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
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
