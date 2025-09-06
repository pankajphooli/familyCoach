'use client'
import { useEffect, useState } from 'react'

type Toast = { id: string, type: 'success'|'error'|'info', text: string }

export default function ToastHost(){
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    (window as any).toast = (type: Toast['type'], text: string) => {
      const id = Math.random().toString(36).slice(2,8)
      setToasts(t => [...t, { id, type, text }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }
  }, [])
  return (
    <div style={{position:'fixed',top:16,right:16,display:'flex',flexDirection:'column',gap:10,zIndex:9999}}>
      {toasts.map(t => (
        <div key={t.id} style={{background: t.type==='error' ? '#fee2e2' : (t.type==='success' ? '#dcfce7' : '#e0f2fe'), color: '#111827', border:'1px solid rgba(0,0,0,.1)', borderRadius:12, padding:'10px 12px'}}>
          <b style={{marginRight:8}}>{t.type==='error' ? 'Uh-oh!' : (t.type==='success' ? 'Nice!' : 'Heads up')}</b><span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
