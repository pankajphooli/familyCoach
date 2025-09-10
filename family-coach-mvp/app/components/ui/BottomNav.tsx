'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'

function Icon({ name }: { name: 'home'|'plans'|'calendar'|'grocery'|'profile' }) {
  const common = {
    width: 24, height: 24, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 11v9h14v-9"/><path d="M9 20v-6h6v6"/></svg>
    case 'plans':
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/></svg>
    case 'grocery':
      return <svg {...common}><path d="M6 6h15l-1.5 8.5a2 2 0 0 1-2 1.6H9.5a2 2 0 0 1-2-1.6L5 3H3"/><circle cx="10" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/></svg>
    case 'profile':
      return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>
  }
}

export default function BottomNav() {
  const pathname = usePathname()
  const is = (p: string) => pathname === p

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Primary">
      <ul>
        <li><Link className={is('/') ? 'active' : ''} href="/"><Icon name="home" /></Link></li>
        <li><Link className={is('/plans') ? 'active' : ''} href="/plans"><Icon name="plans" /></Link></li>
        <li><Link className={is('/calendar') ? 'active' : ''} href="/calendar"><Icon name="calendar" /></Link></li>
        <li><Link className={is('/grocery') ? 'active' : ''} href="/grocery"><Icon name="grocery" /></Link></li>
        <li><Link className={is('/profile') ? 'active' : ''} href="/profile"><Icon name="profile" /></Link></li>
      </ul>
    </nav>
  )
}
