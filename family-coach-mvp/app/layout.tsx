
// app/layout.tsx
import '../styles/globals.css'
import './styles/mobile.css'
import './globals.css'
import './globals-bottomnav-fix.css'
import type { Metadata } from 'next'
import MobileHeader from './components/ui/MobileHeader'
import BottomNav from './components/ui/BottomNav'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'HouseholdHQ',
  description: 'Family plans, diet, workouts, calendar, and grocery — all in one place.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Main page content */}
        <main>
          {children}
        </main>

        {/* Fixed bottom navigation (must render AFTER children) */}
        <BottomNav />
      </body>
    </html>
  )
}
