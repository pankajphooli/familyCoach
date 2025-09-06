'use client'
import { useEffect, useState } from 'react'

export default function ThemeToggle(){
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    const pref = typeof window !== 'undefined' ? localStorage.getItem('hhq_theme') : null
    if (pref === 'dark') document.documentElement.classList.add('dark')
  }, [])
  const toggle = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    try { localStorage.setItem('hhq_theme', isDark ? 'dark' : 'light') } catch {}
  }
  if (!mounted) return null
  return (
    <button className="button ghost" aria-label="Toggle theme" onClick={toggle} title="Toggle theme">🌓</button>
  )
}
