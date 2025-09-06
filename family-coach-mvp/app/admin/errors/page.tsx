'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

export default function AdminErrors(){
  const supabase = createClient()
  const [rows, setRows] = useState<any[]>([])

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: prof } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    const { data } = await supabase.from('app_errors').select('*').eq('family_id', prof?.family_id).order('created_at', { ascending: false }).limit(200)
    setRows(data||[])
  }
  useEffect(()=>{ load() }, [])

  return (
    <div className="grid">
      <div className="card">
        <h2>App Errors</h2>
        <small className="muted">Showing last 200 for your family.</small>
      </div>
      <div className="grid">
        {rows.length===0 && <p className="muted">No errors logged. (That’s a flex.)</p>}
        {rows.map(r => (
          <div key={r.id} className="card">
            <div><b>{new Date(r.created_at).toLocaleString()}</b> — <code>{r.path}</code></div>
            <div style={{whiteSpace:'pre-wrap',marginTop:6}}>{r.message}</div>
            {r.stack && <details style={{marginTop:6}}><summary>Stack</summary><pre style={{whiteSpace:'pre-wrap'}}>{r.stack}</pre></details>}
            {r.context && <details style={{marginTop:6}}><summary>Context</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(r.context,null,2)}</pre></details>}
          </div>
        ))}
      </div>
    </div>
  )
}
