'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Item = any

export default function Grocery(){
  const supabase = createClient()
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if (!profile?.family_id) return
    setFamilyId(profile.family_id)

    const { data: its } = await supabase.from('grocery_items').select('*').eq('family_id', profile.family_id).order('last_added_at', { ascending: false })
    setItems(its || [])

    // suggestions by frequency (top 10)
    const { data: sugg } = await supabase.from('grocery_items').select('name, freq_count').eq('family_id', profile.family_id).order('freq_count', { ascending: false }).limit(10)
    setSuggestions((sugg || []).map((s:any)=>s.name))
  }

  useEffect(()=>{ load() }, [])

  const addItem = async () => {
    if (!familyId || !name.trim()) return
    // upsert by name within family (simple approach)
    const existing = items.find(i => i.name.toLowerCase() === name.trim().toLowerCase())
    if (existing){
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('grocery_items').update({
        qty: qty || existing.qty, unit: unit || existing.unit,
        is_checked: false, last_added_at: new Date().toISOString(),
        freq_count: (existing.freq_count||1) + 1, added_by: user?.id || null
      }).eq('id', existing.id)
      if (error) return alert(error.message)
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('grocery_items').insert({
        family_id: familyId, name: name.trim(), qty: qty || null, unit: unit || null, added_by: user?.id || null
      })
      if (error) return alert(error.message)
    }
    setName(''); setQty(''); setUnit('')
    load()
  }

  const toggleItem = async (id:string, curr:boolean) => {
    const { error } = await supabase.from('grocery_items').update({ is_checked: !curr }).eq('id', id)
    if (error) return alert(error.message)
    load()
  }

  const startSession = async () => {
    if (!familyId) return
    const { error } = await supabase.from('grocery_sessions').insert({ family_id: familyId })
    if (error) return alert(error.message)
    alert('Shopping session started. You can now tick items while shopping.')
  }

  const completeSession = async () => {
    if (!familyId) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data: sess, error: e1 } = await supabase.from('grocery_sessions').insert({ family_id: familyId, completed_at: new Date().toISOString(), completed_by: user?.id || null }).select().single()
    if (e1) return alert(e1.message)
    // Move checked items to purchases
    const checked = items.filter(i => i.is_checked)
    if (checked.length > 0){
      const payload = checked.map(i => ({ family_id: familyId, session_id: sess.id, name: i.name, qty: i.qty, unit: i.unit, purchased_by: user?.id || null }))
      const { error: e2 } = await supabase.from('grocery_purchases').insert(payload)
      if (e2) return alert(e2.message)
      // Delete checked items from active list
      const ids = checked.map(i => i.id)
      const { error: e3 } = await supabase.from('grocery_items').delete().in('id', ids)
      if (e3) return alert(e3.message)
    }
    alert('Session completed and items moved to history.')
    load()
  }

  const addSuggestion = (s:string) => {
    setName(s)
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Grocery List</h2>
        <div className="grid grid-3">
          <input className="input" placeholder="Item name" value={name} onChange={e=>setName(e.target.value)} />
          <input className="input" placeholder="Qty (e.g., 2)" value={qty} onChange={e=>setQty(e.target.value)} />
          <input className="input" placeholder="Unit (e.g., kg, pack)" value={unit} onChange={e=>setUnit(e.target.value)} />
        </div>
        <div style={{display:'flex',gap:12,marginTop:10}}>
          <button className="button" onClick={addItem}>Add to list</button>
          <button className="button" onClick={startSession}>Start shopping</button>
          <button className="button" onClick={completeSession}>Complete session</button>
        </div>
        {suggestions.length>0 && (
          <div style={{marginTop:10}}>
            <small className="muted">Frequent items</small>
            <div className="pills" style={{marginTop:6}}>
              {suggestions.map(s => <span key={s} className="pill" onClick={()=>addSuggestion(s)} style={{cursor:'pointer'}}>{s}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Current list</h3>
        <div className="grid">
          {items.map(i => (
            <div key={i.id} className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <b>{i.name}</b> <small className="muted">{[i.qty,i.unit].filter(Boolean).join(' ')}</small>
              </div>
              <label className="checkbox-item"><input type="checkbox" checked={i.is_checked} onChange={()=>toggleItem(i.id, i.is_checked)} /> Bought</label>
            </div>
          ))}
          {items.length===0 && <p>No items. Add something above or from Today’s plan.</p>}
        </div>
      </div>
    </div>
  )
}
