'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'
import type { CSSProperties, SVGProps } from 'react'

type IconName = 'home'|'plans'|'calendar'|'grocery'|'profile'

function Icon({name, active=false}:{name:IconName; active?:boolean}){
  const svgProps: SVGProps<SVGSVGElement> = {
    width: 24, height: 24, viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { opacity: active ? 1 : 0.6 } as CSSProperties,
  }
  switch(name){
    case 'home':
      return (<svg {...svgProps}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 11v9h14v-9"/><path d="M9 20v-6h6v6"/></svg>)
    case 'plans':
      return (<svg {...svgProps}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>)
    case 'calendar':
      return (<svg {...svgProps}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/></svg>)
    case 'grocery':
      return (<svg {...svgProps}><path d="M6 6h15l-1.5 8.5a2 2 0 0 1-2 1.6H9.5a2 2 0 0 1-2-1.6L5 3H3"/><circle cx="10" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/></svg>)
    case 'profile':
      return (<svg {...svgProps}><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>)
  }
}

export default function BottomNav(){
  const pathname = usePathname() || '/'
  const items = [
    { href:'/', label:'Home', icon:'home' as const },
    { href:'/plans', label:'Plans', icon:'plans' as const },
    { href:'/calendar', label:'Calendar', icon:'calendar' as const },
    { href:'/grocery', label:'Grocery', icon:'grocery' as const },
    { href:'/profile', label:'Profile', icon:'profile' as const },
  ]

  return (
    <nav
      className="fixed left-0 right-0 bottom-0 border-t bg-background/85 backdrop-blur"
      style={{ height: 64, paddingBottom: 'env(safe-area-inset-bottom)', zIndex: 60 }}
    >
      <ul style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', height:'100%'}}>
        {items.map(it=>{
          const active = pathname === it.href || (it.href!=='/' && pathname.startsWith(it.href))
          return (
            <li key={it.href} className="flex flex-col items-center justify-center">
              <Link href={it.href} className="flex flex-col items-center justify-center gap-1" aria-label={it.label}>
                <Icon name={it.icon} active={active} />
                <span className="text-xs" style={{opacity: active?1:0.72}}>{it.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
