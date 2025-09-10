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
  unit?: string | null
}

type HistoryRow = {
  id: string
  name: string
  quantity: number
  purchased_at: string
  user_id?: string | null
  family_id?: string | null
  unit?: string | null
}

type Fav = { name: string; display: string; lastQty: number; unit?: string | null }
type Tab = 'list' | 'history'

const ymd = () => {
  const d = new Date()
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
const norm = (s: string) => s.trim().toLowerCase()

export default function GroceryPage(){
  const supabase = useMemo(()=> createClient(), [])
  const [tab, setTab] = useState<Tab>('list')
  const [loading, setLoading] = useState(true)

  const [userId, setUserId]   = useState<string>('') 
  const [familyId, setFamilyId] = useState<string>('')

  // table detection
  const [listTable, setListTable] = useState<string>('grocery_items')
  const [historyTable, setHistoryTable] = useState<string | null>(null)

  // list state
  const [items, setItems] = useState<ItemRow[]>([])
  const [shoppingActive, setShoppingActive] = useState(false)

  // add form
  const addFormRef = useRef<HTMLDivElement>(null)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState<number>(1)
  const [newUnit, setNewUnit] = useState<string>('')

  // favourites (from history, last bought quantity)
  const [favs, setFavs] = useState<Fav[]>([])

  // history (date wise)
  const [historyByDate, setHistoryByDate] = useState<Record<string, HistoryRow[]>>({})

  function toast(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else (kind==='error' ? console.warn : console.log)(msg)
  }

  /* ---------- table detection ---------- */
  const tryHead = async (name: string) => {
    const r = await supabase.from(name).select('*').limit(1)
    return !r.error
  }
  async function detectTables(){
    const hasG = await tryHead('grocery_items')
    const hasS = await tryHead('shopping_items')
    setListTable(hasG ? 'grocery_items' : (hasS ? 'shopping_items' : 'grocery_items'))

    const cands = ['grocery_history','shopping_history','purchases','grocery_purchases']
    for(const t of cands){
      if(await tryHead(t)){ setHistoryTable(t); return }
    }
    setHistoryTable(null)
  }

  /* ---------- boot ---------- */
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user){ setLoading(false); return }
      setUserId(user.id)
      const prof = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
      setFamilyId((prof.data?.family_id as string) || '')
      await detectTables()
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  // when tables known → load data
  useEffect(()=>{ (async()=>{
    if(!userId) return
    await Promise.all([loadList(), loadHistory(), loadFavs()])
  })() }, [userId, listTable, historyTable]) // eslint-disable-line

  /* ---------- loaders ---------- */
  async function loadList(){
    const sel = supabase.from(listTable).select('id,name,quantity,done,user_id,family_id,created_at,unit').order('created_at',{ascending:true})
    let r = await sel.eq('family_id', familyId)
    if(r.error || (r.data||[]).length===0) r = await sel.eq('user_id', userId)
    if(r.error){ setItems([]); return }
    const rows = (r.data||[]) as any[]
    setItems(rows.map(x => ({ ...x, quantity: Number(x.quantity||1) })))
  }

  async function loadHistory(){
    if(!historyTable){ setHistoryByDate({}); return }
    const r = await supabase.from(historyTable).select('id,name,quantity,purchased_at,user_id,family_id,unit').order('purchased_at',{ascending:false})
    if(r.error){ setHistoryByDate({}); return }
    const by: Record<string, HistoryRow[]> = {}
    for(const row of (r.data||[]) as HistoryRow[]){
      let d = row.purchased_at || ymd()
      if(d.length>10) d = d.slice(0,10)
      ;(by[d] ||= []).push(row)
    }
    setHistoryByDate(by)
  }

  async function loadFavs(){
    if(!historyTable){ setFavs([]); return }
    // get last purchase per normalized name
    const r = await supabase.from(historyTable).select('name,quantity,unit,purchased_at').order('purchased_at',{ascending:false}).limit(500)
    if(r.error){ setFavs([]); return }
    const seen = new Set<string>()
    const res: Fav[] = []
    for(const row of (r.data||[]) as any[]){
      const key = norm(String(row.name||'')); if(!key) continue
      if(seen.has(key)) continue
      seen.add(key)
      res.push({ name: key, display: String(row.name), lastQty: Number(row.quantity||1), unit: row.unit || null })
      if(res.length>=30) break
    }
    setFavs(res)
  }

  /* ---------- actions ---------- */
  async function addItem(rawName: string, qty: number, unit?: string | null){
    const name = norm(rawName)
    if(!name){ toast('error','Enter an item name'); return }
    if(!qty || qty<1) qty = 1

    const exists = items.find(i => norm(i.name) === name)
    if(exists){
      const ok = window.confirm(`"${exists.name}" is already on the list. Increase quantity by ${qty}?`)
      if(!ok) return
      await supabase.from(listTable).update({ quantity: (exists.quantity||1) + qty }).eq('id', exists.id)
      await loadList()
      return
    }

    // Try with unit column first; fall back without it.
    const payloadBase: any = { name, quantity: qty, done: false }
    if(familyId) payloadBase.family_id = familyId; else payloadBase.user_id = userId

    let ok = false
    const tryWithUnit = await supabase.from(listTable).insert({ ...payloadBase, unit: (unit || newUnit || null) }).select('id').maybeSingle()
    if(!tryWithUnit.error){ ok = true }
    if(!ok){
      const tryWithout = await supabase.from(listTable).insert(payloadBase).select('id').maybeSingle()
      if(!tryWithout.error) ok = true
    }
    if(!ok){ toast('error','Could not add item (RLS or schema mismatch).'); return }

    setNewName(''); setNewQty(1); setNewUnit('')
    await loadList()
  }

  async function onFavClick(f: Fav){
    // add with lastQty; same duplicate rules
    await addItem(f.display || f.name, f.lastQty, f.unit||null)
  }

  async function toggleDone(id: string, next: boolean){
    if(!shoppingActive){ toast('error','Tap “Start Shopping” to tick items.'); return }
    await supabase.from(listTable).update({ done: next }).eq('id', id)
    setItems(prev => prev.map(x => x.id===id ? { ...x, done: next } : x))
  }

  async function removeItem(id: string){
    await supabase.from(listTable).delete().eq('id', id)
    setItems(prev => prev.filter(x => x.id !== id))
  }

  function scrollToAdd(){
    addFormRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
  }

  function startShopping(){ setShoppingActive(true) }

  async function completeShopping(){
    const bought = items.filter(x => x.done)
    if(bought.length===0){ toast('error','Nothing marked as bought.'); return }

    if(historyTable){
      const today = ymd()
      const payloads = bought.map(b => ({
        name: b.name, quantity: b.quantity || 1, purchased_at: today,
        ...(b.unit ? { unit: b.unit } : {}),
        ...(familyId ? { family_id: familyId } : {}),
        ...(userId ? { user_id: userId } : {}),
      }))
      const ins = await supabase.from(historyTable).insert(payloads)
      if(ins.error){ console.warn('history insert failed', ins.error) }
    }

    const ids = bought.map(b => b.id)
    if(ids.length) await supabase.from(listTable).delete().in('id', ids)

    setShoppingActive(false)
    await Promise.all([loadList(), loadHistory(), loadFavs()])
    toast('success','Shopping session completed.')
  }

  /* ---------- render ---------- */
  const historyDates = Object.keys(historyByDate).sort((a,b)=> a<b ? 1 : -1)

  return (
    <div className="container" style={{ display:'grid', gap:14, paddingBottom:84 }}>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Grocery List</h1>
        <button className="button add-btn" onClick={scrollToAdd}>Add item</button>
      </div>

      <div className="chips" style={{ overflow:'visible' }}>
        <button className={`chip ${tab==='list'?'on':''}`} onClick={()=>setTab('list')}>Current List</button>
        <button className={`chip ${tab==='history'?'on':''}`} onClick={()=>setTab('history')}>History</button>
      </div>

      {tab==='list' ? (
        <>
          {/* Favourites */}
          <section className="panel">
            <div className="form-title" style={{ marginBottom:8 }}>Favourites</div>
            {favs.length===0 ? (
              <div className="muted">Finish a shopping session to build favourites from history.</div>
            ) : (
              <div className="chips wrap">
                {favs.map(f => (
                  <button key={f.name} className="chip" onClick={()=>onFavClick(f)} title={`Last bought: ${f.lastQty}${f.unit?` ${f.unit}`:''}`}>
                    {f.display} {f.lastQty>1 ? `×${f.lastQty}` : ''}
                  </button>
                ))}
              </div>
            )}

            {/* Start / Complete shopping controls (right aligned) */}
            <div className="actions" style={{ gap:10 }}>
              {!shoppingActive ? (
                <button className="button-outline" onClick={startShopping}>Start Shopping</button>
              ) : (
                <button className="button" onClick={completeShopping}>Complete Shopping</button>
              )}
            </div>
          </section>

          {/* Current list */}
          <section className="panel">
            <div className="grid" style={{ gridTemplateColumns:'1fr auto', alignItems:'center' }}>
              <div className="form-title">Items</div>
              <div className="form-title" style={{ justifySelf:'end' }}>Quantity</div>
            </div>

            {items.length===0 ? (
              <div className="muted">Your list is empty.</div>
            ) : (
              <div style={{ display:'grid', gap:8 }}>
                {items.map(it => (
                  <div key={it.id}
                       className="ev-row"
                       style={{ gridTemplateColumns:'auto 100px 120px', alignItems:'center', columnGap:12 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <input
                        type="checkbox"
                        checked={!!it.done}
                        onChange={e=>toggleDone(it.id, e.target.checked)}
                        disabled={!shoppingActive}
                        title={shoppingActive ? 'Mark bought' : 'Start shopping to tick items'}
                      />
                      <span
                        className="ev-title"
                        style={{
                          fontSize:20,
                          fontWeight:800,
                          textDecoration: it.done ? 'line-through' : 'none',
                          opacity: it.done ? .55 : 1
                        }}
                      >
                        {it.name}
                      </span>
                    </label>

                    <div className="ev-time" style={{ justifySelf:'end' }}>
                      {it.quantity || 1}{it.unit ? ` ${it.unit}` : ''}
                    </div>

                    <div style={{ display:'flex', justifyContent:'flex-end' }}>
                      <button className="button-outline" onClick={()=>removeItem(it.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Add form */}
          <section className="panel" ref={addFormRef}>
            <div className="form-title">Add Items</div>
            <div className="grid" style={{ display:'grid', gridTemplateColumns:'1fr 120px 140px auto', gap:10 }}>
              <input className="line-input" placeholder="Item name" value={newName} onChange={e=>setNewName(e.target.value)} />
              <input className="line-input" type="number" min={1} placeholder="Qty" value={newQty} onChange={e=>setNewQty(Math.max(1, Number(e.target.value||1)))} />
              <input className="line-input" placeholder="Unit (e.g., kg, pk, gms)" value={newUnit} onChange={e=>setNewUnit(e.target.value)} />
              <button className="button" onClick={()=>addItem(newName, newQty, newUnit || null)}>Save item</button>
            </div>
          </section>
        </>
      ) : (
        /* History */
        <section className="panel">
          {historyTable===null ? (
            <div className="muted">History table isn’t enabled yet. I can give you the SQL if you want it.</div>
          ) : Object.keys(historyByDate).length===0 ? (
            <div className="muted">No purchases yet.</div>
          ) : (
            <div style={{ display:'grid', gap:14 }}>
              {Object.keys(historyByDate).sort((a,b)=> a<b ? 1 : -1).map(d => (
                <div key={d} style={{ display:'grid', gap:8 }}>
                  <div className="lbl">{d}</div>
                  {(historyByDate[d]||[]).map(h => (
                    <div key={h.id} className="ev-row" style={{ gridTemplateColumns:'1fr 140px', alignItems:'center' }}>
                      <div className="ev-title" style={{ fontSize:18, fontWeight:700 }}>{h.name}</div>
                      <div className="ev-time" style={{ justifySelf:'end' }}>
                        {h.quantity || 1}{h.unit ? ` ${h.unit}` : ''}
                      </div>
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
