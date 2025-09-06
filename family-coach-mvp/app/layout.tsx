import '../styles/globals.css'
import Link from 'next/link'

export const metadata = { title: 'HouseholdHQ', description: 'Family calendar, meals & workouts, and grocery — all in one.' }

export default function RootLayout({ children }: { children: React.ReactNode }){
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="site-header">
            <div className="brand">
              <span className="badge">MVP</span>
              <b>HouseholdHQ</b>
            </div>
            <nav className="topnav">
              <Link href="/">Home</Link>
              <Link href="/family">Family</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/grocery">Grocery</Link>
              <Link href="/today">Today</Link>
              <Link href="/progress">Progress</Link>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <small className="muted">Wellness guidance only. Not medical advice.</small>
          </footer>
        </div>
      </body>
    </html>
  )
}
