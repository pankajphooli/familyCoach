'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type ItemRow = {
  id: string
  name: string
  quantity: number
  done: boolean
  user_id?: string | null
  family_id?: string | null
  created_at?: string | null
}
type HistoryRow = {
  id: string
  name: string
  quantity: number
  purchased_at: string  // YYYY-MM-DD or timestamp
  user_id?: string | null
  family_id?: string | null
}
type Tab = 'list' | 'history'

const todayYMD = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const norm = (s: string) => s.trim().toLowerCase()

export default function GroceryPage(){
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('list')

  const [userId, setUserId] = useState<string>('')
  const [familyId, setFamilyId] = useState<string>('')

  // live list table + history table detection
  const [listTable, setListTable] = useState<string>('grocery_items')       // fallback to shopping_items if needed
  const [historyTable, setHistoryTable] = useState<string | null>(null)     // grocery_history | shopping_history | null

  // current list
  const [items, setItems] = useState<ItemRow[]>([])
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState<number>(1)

  // frequent (from history)
  const [frequent, setFrequent] = useState<{ name: string; count: number }[]>([])

  // shopping session
  const [shoppingActive, setShoppingActive] = useState(false)

  // history
  const [historyByDate, setHistoryByDate] = useState<Record<string, HistoryRow[]>>({})

  function toast(kind: 'success' | 'error', msg: string){
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else (kind === 'error' ? console.warn : console.log)(msg)
  }

  async function detectTables(){
    // Determine which tables exist in this project without breaking if some don’t
    const tryHead = async (name: string) => {
      const r = await supabase.from(name).select('*').limit(1)
      return !r.error
    }
    const hasGrocery = await tryHead('grocery_items')
    const hasShopping = await tryHead('shopping_items')
    setListTable(hasGrocery ? 'grocery_items' : (hasShopping ? 'shopping_items' : 'grocery_items'))

    const candidates = ['grocery_history', 'shopping_history', 'purchases', 'grocery_purchases']
    for (const t of candidates){
      const ok = await tryHead(t)
      if (ok){ setHistoryTable(t); return }
    }
    setHistoryTable(null) // no history table yet (we still work; just no history persist)
  }

  useEffect(() => { (async()=>{
    setLoading(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ setLoading(false); return }
      setUserId(user.id)

      // get family (if any)
      const prof = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
      setFamilyId((prof.data?.family_id as string) || '')

      await detectTables()
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  // Once listTable/historyTable known → load data
  useEffect(() => { (async()=>{
    if(!userId) return
    await Promise.all([loadList(), loadHistory(), loadFrequent()])
  })() }, [userId, listTable, historyTable]) // eslint-disable-line

  /* ----------------- load helpers ----------------- */
  async function loadList(){
    const sel = supabase.from(listTable).select('id,name,quantity,done,user_id,family_id,created_at').order('created_at', { ascending: true })
    // Prefer family scope if present, else user
    let r = await sel.eq('family_id', familyId)
    if (r.error || (r.data||[]).length===0) r = await sel.eq('user_id', userId)
    if (r.error) { setItems([]); return }
    // ensure number type
    const rows: ItemRow[] = (r.data as any[]).map(x => ({ ...x, quantity: Number(x.quantity||1) }))
    setItems(rows)
  }

  async function loadHistory(){
    if(!historyTable){ setHistoryByDate({}); return }
    const r = await supabase.from(historyTable).select('id,name,quantity,purchased_at,user_id,family_id').order('purchased_at', { ascending: false })
    if(r.error){ setHistoryByDate({}); return }
    const rows = (r.data || []) as HistoryRow[]
    const by: Record<string, HistoryRow[]> = {}
    for(const row of rows){
      let d = row.purchased_at
      if(d && d.length > 10) d = d.slice(0,10)
      d = d || todayYMD()
      ;(by[d] ||= []).push(row)
    }
    setHistoryByDate(by)
  }

  async function loadFrequent(){
    if(!historyTable){ setFrequent([]); return }
    // Pull last ~180 days, aggregate client-side
    const from = new Date(); from.setDate(from.getDate() - 180)
    const iso = from.toISOString().slice(0,10)
    let r = await supabase.from(historyTable).select('name,quantity,purchased_at').gte('purchased_at', iso).order('purchased_at', { ascending:false })
    if(r.error){ setFrequent([]); return }
    const counts = new Map<string, number>()
    for(const row of (r.data||[]) as any[]){
      const k = norm(String(row.name||''))
      if(!k) continue
      counts.set(k, (counts.get(k)||0) + Number(row.quantity||1))
    }
    const list = Array.from(counts.entries()).map(([k,v]) => ({ name: k, count: v }))
      .sort((a,b)=> b.count-a.count).slice(0,24)
    setFrequent(list)
  }

  /* ----------------- actions ----------------- */
  async function addItem(rawName: string, qty: number){
    const name = norm(rawName)
    if(!name){ toast('error','Add an item name'); return }
    if(qty < 1) qty = 1

    // check duplicate (case-insensitive)
    const exists = items.find(it => norm(it.name) === name)
    if(exists){
      const ok = window.confirm(`"${exists.name}" is already on the list. Increase quantity by ${qty}?`)
      if(!ok) return
      await supabase.from(listTable).update({ quantity: (exists.quantity||1) + qty }).eq('id', exists.id)
      await loadList()
      return
    }

    // insert new
    const payloads: any[] = []
    // prefer family scoping if available
    if(familyId) payloads.push({ name, quantity: qty, done: false, family_id: familyId })
    payloads.push({ name, quantity: qty, done: false, user_id: userId })

    let inserted = false
    for(const p of payloads){
      const ins = await supabase.from(listTable).insert(p).select('id').maybeSingle()
      if(!ins.error){ inserted = true; break }
    }
    if(!inserted){
      toast('error','Could not add item (RLS or schema mismatch).')
      return
    }
    await loadList()
    setNewName(''); setNewQty(1)
  }

  async function fromFrequentClick(name: string){
    await addItem(name, 1)
  }

  async function toggleDone(id: string, next: boolean){
    if(!shoppingActive){
      toast('error','Start a shopping session to mark items bought.')
      return
    }
    await supabase.from(listTable).update({ done: next }).eq('id', id)
    setItems(prev => prev.map(x => x.id === id ? { ...x, done: next } : x))
  }

  async function removeItem(id: string){
    await supabase.from(listTable).delete().eq('id', id)
    setItems(prev => prev.filter(x => x.id !== id))
  }

  async function startShopping(){
    setShoppingActive(true)
  }

  async function completeShopping(){
    // move done items → history (if table exists), then delete from list
    const bought = items.filter(x => x.done)
    if(bought.length === 0){ toast('error','No items marked as bought.'); return }

    if(historyTable){
      const today = todayYMD()
      const payloads = bought.map(b => ({
        name: b.name,
        quantity: b.quantity || 1,
        purchased_at: today,
        ...(familyId ? { family_id: familyId } : {}),
        ...(userId ? { user_id: userId } : {}),
      }))
      const ins = await supabase.from(historyTable).insert(payloads)
      if(ins.error){
        // keep going; history is best-effort
        console.warn('history insert failed', ins.error)
      }
    }

    // delete bought from list
    const ids = bought.map(b => b.id)
    if(ids.length){
      await supabase.from(listTable).delete().in('id', ids)
    }
    setShoppingActive(false)
    await Promise.all([loadList(), loadHistory(), loadFrequent()])
    toast('success','Shopping session completed.')
  }

  /* ----------------- UI helpers ----------------- */
  const frequentEmpty = !frequent.length
  const historyDates = Object.keys(historyByDate).sort((a,b)=> a<b ? 1 : -1)

  return (
    <div className="container" style={{ display:'grid', gap: 14, paddingBottom: 84 }}>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Grocery</h1>
        <div className="chips" style={{ overflow:'visible' }}>
          <button className={`chip ${tab==='list'?'on':''}`} onClick={()=>setTab('list')}>List</button>
          <button className={`chip ${tab==='history'?'on':''}`} onClick={()=>setTab('history')}>History</button>
        </div>
      </div>

      {tab==='list' && (
        <>
          {/* Frequent items */}
          <section className="panel">
            <div className="flex items-center justify-between">
              <div className="form-title">Frequent items</div>
              {!historyTable && <div className="muted" style={{fontSize:13}}>History not enabled yet</div>}
            </div>
            {frequentEmpty ? (
              <div className="muted">No history yet — items you buy in completed sessions will appear here.</div>
            ) : (
              <div className="chips wrap" style={{ marginTop: 6 }}>
                {frequent.map(fi => (
                  <button key={fi.name} className="chip" onClick={()=>fromFrequentClick(fi.name)} title={`Bought ${fi.count}× recently`}>
                    {fi.name}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Add form + session controls */}
          <section className="panel">
            <div className="form-title">Add item</div>
            <div className="grid-3">
              <input className="pill-input" placeholder="e.g., milk" value={newName} onChange={e=>setNewName(e.target.value)} />
              <input className="pill-input" type="number" min={1} value={newQty} onChange={e=>setNewQty(Math.max(1, Number(e.target.value||1)))} />
              <button className="button" onClick={()=>addItem(newName, newQty)}>Add</button>
            </div>

            <div className="actions" style={{ gap: 10 }}>
              {!shoppingActive ? (
                <button className="button-outline" onClick={startShopping} title="Enable ticking items">Start shopping</button>
              ) : (
                <button className="button" onClick={completeShopping} title="Move bought items to history">Complete shopping</button>
              )}
            </div>
          </section>

          {/* Current list (one item per row) */}
          <section className="panel">
            <div className="form-title">Current list</div>
            {items.length === 0 ? (
              <div className="muted">Your list is empty.</div>
            ) : (
              <div style={{ display:'grid', gap: 8, marginTop: 6 }}>
                {items.map(it => (
                  <div key={it.id} className="ev-row" style={{ gridTemplateColumns:'auto 80px 110px 90px', alignItems:'center', columnGap: 10 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <input
                        type="checkbox"
                        checked={!!it.done}
                        onChange={e=>toggleDone(it.id, e.target.checked)}
                        disabled={!shoppingActive}
                        title={shoppingActive ? 'Mark bought' : 'Start shopping to tick items'}
                      />
                      <span className="ev-title" style={{ fontSize:18, fontWeight:700 }}>{it.name}</span>
                    </label>
                    <div className="ev-time">
                      Qty: {it.quantity || 1}
                    </div>
                    <div style={{ display:'flex', gap: 8, justifyContent:'flex-end' }}>
                      <button
                        className="button-outline"
                        onClick={async ()=>{
                          // Increase quantity by 1
                          await supabase.from(listTable).update({ quantity: (it.quantity||1) + 1 }).eq('id', it.id)
                          setItems(prev => prev.map(x => x.id === it.id ? { ...x, quantity: (x.quantity||1)+1 } : x))
                        }}
                      >
                        +1
                      </button>
                      <button
                        className="button-outline"
                        onClick={async ()=>{
                          // Decrease (min 1)
                          const next = Math.max(1, (it.quantity||1) - 1)
                          await supabase.from(listTable).update({ quantity: next }).eq('id', it.id)
                          setItems(prev => prev.map(x => x.id === it.id ? { ...x, quantity: next } : x))
                        }}
                      >
                        −1
                      </button>
                    </div>
                    <div style={{ display:'flex', justifyContent:'flex-end' }}>
                      <button className="button-outline" onClick={()=>removeItem(it.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab==='history' && (
        <section className="panel">
          {!historyTable ? (
            <div className="muted">
              History isn’t enabled. You can add it with a simple table — ask me and I’ll give you the one-time SQL.
            </div>
          ) : historyDates.length === 0 ? (
            <div className="muted">No purchases yet.</div>
          ) : (
            <div style={{ display:'grid', gap: 14 }}>
              {historyDates.map(d => (
                <div key={d} style={{ display:'grid', gap:8 }}>
                  <div className="lbl">{d}</div>
                  {(historyByDate[d]||[]).map(h => (
                    <div key={h.id} className="ev-row" style={{ gridTemplateColumns:'1fr 100px', alignItems:'center' }}>
                      <div className="ev-title" style={{ fontSize:18, fontWeight:700 }}>{h.name}</div>
                      <div className="ev-time">Qty: {h.quantity || 1}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
