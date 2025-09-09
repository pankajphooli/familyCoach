'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/',        label: 'Home',     icon: '🏠' },
  { href: '/plans',   label: 'Plans',    icon: '📅' },
  { href: '/calendar',label: 'Calendar', icon: '🗓️' },
  { href: '/grocery', label: 'Grocery',  icon: '🛒' },
  { href: '/family',  label: 'Family',   icon: '👪' },
]

export default function BottomNav(){
  const pathname = usePathname() || '/'
  return (
    <nav className="bottom-nav">
      {items.map(it=>{
        const active = pathname===it.href || (it.href!=='/' && pathname.startsWith(it.href))
        return (
          <Link key={it.href} href={it.href} className={active?'active':''}>
            <div className="icon" aria-hidden>{it.icon}</div>
            <div>{it.label}</div>
          </Link>
        )
      })}
    </nav>
  )
}
