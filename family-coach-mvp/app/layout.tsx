import '../styles/globals.css'
import './styles/mobile.css'
import type { Metadata } from 'next'
import MobileHeader from './components/ui/MobileHeader'
import BottomNav from './components/ui/BottomNav'

export const metadata: Metadata = {
  title: 'HouseholdHQ',
  description: 'Family planning, health, and groceries',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen pb-24">{children}</main>
        <BottomNav />
      </body>
    </html>
  )
}
