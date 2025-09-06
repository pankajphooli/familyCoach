
import './globals.css'
import '../styles/globals.css'
import Link from 'next/link'

export const metadata = { title: 'Family Coach MVP', description: 'Diet & Fitness Coach for families' }

export default function RootLayout({ children }: { children: React.ReactNode }){
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="flex" style={{justifyContent:'space-between', marginBottom:16}}>
            <div className="flex" style={{gap:8}}>
              <span className="badge">MVP</span>
              <b>Family Coach</b>
            </div>
            <nav className="flex" style={{gap:16}}>
              <Link href="/">Home</Link>
              <Link href="/onboarding">Onboarding</Link>
              <Link href="/family">Family</Link>
              <Link href="/today">Today</Link>
              <Link href="/progress">Progress</Link>
            </nav>
          </header>
          {children}
          <footer style={{marginTop:24}}>
            <small className="muted">Wellness guidance only. Not medical advice.</small>
          </footer>
        </div>
      </body>
    </html>
  )
}
