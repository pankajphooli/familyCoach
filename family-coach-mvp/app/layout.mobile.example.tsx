/* app/layout.mobile.example.tsx */
import './globals.css'
import './styles/mobile.css'
import type { Metadata } from 'next'
import MobileHeader from './components/ui/MobileHeader'
import BottomNav from './components/ui/BottomNav'

export const metadata: Metadata = {
  title: 'HouseholdHQ',
  description: 'Family planning, health, and groceries — mobile-first',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mobile-shell light">
        <MobileHeader title="HouseholdHQ" />
        <main className="mobile-content">{children}</main>
        <BottomNav />
      </body>
    </html>
  )
}
