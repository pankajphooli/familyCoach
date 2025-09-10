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
  unit?: string | null
  user_id?: string | null
  family_id?: string | null
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

  const [userId, setUserId] = useState('')
  const [familyId, setFamilyId] = useState('')

  const [listTable, setListTable] = useState('grocery_items')
  const [historyTable, setHistoryTable] = useState<string | null>(null)

  const [items, setItems] = useState<ItemRow[]>([])
  const [shoppingActive, setShoppingActive] = useState(false)

  const [favs, setFavs] = useState<Fav[]>([])
  const [historyByDate, setHistoryByDate] = useState<Record<string, HistoryRow[]>>({})

  // Add form
  const addRef = useRef<HTMLDivElement>(null)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState<number>(1)
  const [newUnit, setNewUnit] = useState('')

  function toast(kind:'success'|'error', msg:string){
    if(typeof window!=='undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else (kind==='error' ? console.warn : console.log)(msg)
  }

  /* -------- detect tables -------- */
  const tryHead = async (name: string) => {
    const r = await supabase.from(name).select('*').limit(1)
    return !r.error
  }
  async function detectTables(){
    const hasG = await tryHead('grocery_items')
    const hasS = await tryHead('shopping_items')
    setListTable(hasG ? 'grocery_items' : (hasS ? 'shopping_items' : 'grocery_items'))

    for(const t of ['grocery_history','shopping_history','purchases','grocery_purchases']){
      if(await tryHead(t)){ setHistoryTable(t); return }
    }
    setHistoryTable(null)
  }

  /* -------- boot -------- */
  useEffect(()=>{ (async()=>{
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user) return
    setUserId(user.id)
    const prof = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    setFamilyId((prof.data?.family_id as string) || '')
    await detectTables()
  })() }, []) // eslint-disable-line

  useEffect(()=>{ (async()=>{
    if(!userId) return
    await Promise.all([loadList(), loadHistory(), loadFavs()])
  })() }, [userId, listTable, historyTable]) // eslint-disable-line

  /* -------- loaders -------- */
  async function loadList(){
    const sel = supabase.from(listTable).select('id,name,quantity,done,user_id,family_id,created_at,unit').order('created_at',{ascending:true})
    let r = await sel.eq('family_id', familyId)
    if(r.error || (r.data||[]).length===0) r = await sel.eq('user_id', userId)
    if(r.error){ setItems([]); return }
    setItems(((r.data||[]) as any[]).map(x => ({ ...x, quantity: Number(x.quantity||1) })))
  }
  async function loadHistory(){
    if(!historyTable){ setHistoryByDate({}); return }
    const r = await supabase.from(historyTable).select('id,name,quantity,purchased_at,unit').order('purchased_at',{ascending:false})
    if(r.error){ setHistoryByDate({}); return }
    const by: Record<string, HistoryRow[]> = {}
    for(const row of (r.data||[]) as HistoryRow[]){
      const d = (row.purchased_at || ymd()).slice(0,10)
      ;(by[d] ||= []).push(row)
    }
    setHistoryByDate(by)
  }
  async function loadFavs(){
    if(!historyTable){ setFavs([]); return }
    const r = await supabase.from(historyTable).select('name,quantity,unit,purchased_at').order('purchased_at',{ascending:false}).limit(500)
    if(r.error){ setFavs([]); return }
    const seen = new Set<string>(); const out: Fav[] = []
    for(const row of (r.data||[]) as any[]){
      const key = norm(String(row.name||'')); if(!key || seen.has(key)) continue
      seen.add(key)
      out.push({ name:key, display:String(row.name), lastQty:Number(row.quantity||1), unit: row.unit||null })
      if(out.length>=30) break
    }
    setFavs(out)
  }

  /* -------- actions -------- */
  async function addItem(rawName: string, qty: number, unit?: string | null){
    const name = norm(rawName)
    if(!name){ toast('error','Enter an item name'); return }
    if(!qty || qty<1) qty = 1

    const exists = items.find(i => norm(i.name) === name)
    if(exists){
      const ok = window.confirm(`"${exists.name}" already exists. Increase quantity by ${qty}?`)
      if(!ok) return
      await supabase.from(listTable).update({ quantity: (exists.quantity||1) + qty }).eq('id', exists.id)
      await loadList()
      toast('success','Quantity updated')
      return
    }

    const base: any = { name, quantity: qty, done:false }
    if(familyId) base.family_id = familyId; else base.user_id = userId

    let ok = false
    const r1 = await supabase.from(listTable).insert({ ...base, unit: unit ?? (newUnit || null) }).select('id').maybeSingle()
    if(!r1.error) ok = true
    if(!ok){
      const r2 = await supabase.from(listTable).insert(base).select('id').maybeSingle()
      if(!r2.error) ok = true
    }
    if(!ok){ toast('error','Could not add item (check RLS/schema).'); return }

    setNewName(''); setNewQty(1); setNewUnit('')
    await loadList()
    toast('success','Item added')
  }
  async function onFavClick(f: Fav){ await addItem(f.display || f.name, f.lastQty, f.unit||null) }
  async function toggleDone(id: string, next: boolean){
    if(!shoppingActive){ toast('error','Tap “Start Shopping” to tick items.'); return }
    await supabase.from(listTable).update({ done: next }).eq('id', id)
    setItems(p => p.map(x => x.id===id ? { ...x, done: next } : x))
  }
  async function removeItem(id: string){
    await supabase.from(listTable).delete().eq('id', id)
    setItems(p => p.filter(x => x.id!==id))
  }
  function scrollToAdd(){ addRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }) }
  function startShopping(){ setShoppingActive(true) }
  async function completeShopping(){
    const bought = items.filter(x => x.done)
    if(bought.length===0){ toast('error','Nothing marked as bought.'); return }
    if(historyTable){
      const payloads = bought.map(b => ({
        name:b.name, quantity:b.quantity||1, unit:b.unit||null, purchased_at: ymd(),
        ...(familyId ? {family_id:familyId}:{user_id:userId})
      }))
      await supabase.from(historyTable).insert(payloads)
    }
    if(bought.length) await supabase.from(listTable).delete().in('id', bought.map(b=>b.id))
    setShoppingActive(false)
    await Promise.all([loadList(), loadHistory(), loadFavs()])
    toast('success','Shopping session completed')
  }

  /* -------- render -------- */
  const historyDates = Object.keys(historyByDate).sort((a,b)=> a<b ? 1 : -1)

  return (
    <div className="container" style={{ display:'grid', gap:14, paddingBottom:84, overflowX:'hidden' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h1 className="page-title">Grocery List</h1>
        <button className="button add-btn" onClick={scrollToAdd} type="button">Add item</button>
      </div>

      {/* Text tabs */}
      <div className="tabbar">
        <button className={`tab ${tab==='list'?'on':''}`} onClick={()=>setTab('list')} type="button">Current List</button>
        <button className={`tab ${tab==='history'?'on':''}`} onClick={()=>setTab('history')} type="button">History</button>
      </div>

      {tab==='list' ? (
        <>
          {/* Favourites (borderless, horizontal scroll) */}
          <section aria-label="Favourites">
            <div className="section-title">Favourites</div>
            <div className="fav-row">
              {favs.length===0 ? (
                <div className="muted">Finish a shopping session to build favourites.</div>
              ) : (
                favs.map(f=>(
                  <button key={f.name} className="chip" onClick={()=>onFavClick(f)} type="button" title={`Last: ${f.lastQty}${f.unit?` ${f.unit}`:''}`}>
                    {f.display}{f.lastQty>1?` ×${f.lastQty}`:''}
                  </button>
                ))
              )}
            </div>

            {/* Start / Complete shopping (left, like mock) */}
            <div style={{ marginTop:12 }}>
              {!shoppingActive ? (
                <button className="button-outline" onClick={startShopping} type="button">Start Shopping</button>
              ) : (
                <button className="button" onClick={completeShopping} type="button">Complete Shopping</button>
              )}
            </div>
          </section>

          {/* Current list (no horizontal scroll; responsive) */}
          <section className="panel">
            {items.length===0 ? (
              <div className="muted">Your list is empty.</div>
            ) : (
              <ul className="list">
                {items.map(it=>(
                  <li key={it.id} className="row">
                    <label className="left">
                      <input
                        type="checkbox"
                        checked={!!it.done}
                        disabled={!shoppingActive}
                        onChange={e=>toggleDone(it.id, e.target.checked)}
                      />
                      <span className={`name ${it.done?'done':''}`}>{it.name}</span>
                    </label>
                    <div className="qty">{it.quantity || 1}{it.unit ? ` ${it.unit}` : ''}</div>
                    <button className="button-outline rm" onClick={()=>removeItem(it.id)} type="button">Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add Items card (stacked inputs, button bottom-right) */}
          <section className="panel" ref={addRef}>
            <div className="form-title">Add Items</div>
            <div className="add-grid">
              <input className="line-input" placeholder="Item name" value={newName} onChange={e=>setNewName(e.target.value)} />
              <input className="line-input" type="number" min={1} placeholder="Quantity" value={newQty} onChange={e=>setNewQty(Math.max(1, Number(e.target.value||1)))} />
              <input className="line-input" placeholder="Unit (e.g., kg, pk, gms)" value={newUnit} onChange={e=>setNewUnit(e.target.value)} />
              <div className="save-wrap">
                <button className="button" onClick={()=>addItem(newName, newQty, newUnit||null)} type="button">Save item</button>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          {historyDates.length===0 ? (
            <div className="muted">No purchases yet.</div>
          ) : (
            <div style={{ display:'grid', gap:14 }}>
              {historyDates.map(d=>(
                <div key={d} style={{ display:'grid', gap:8 }}>
                  <div className="lbl">{d}</div>
                  {(historyByDate[d]||[]).map(h=>(
                    <div key={h.id} className="row hist">
                      <div className="name">{h.name}</div>
                      <div className="qty">{h.quantity || 1}{h.unit ? ` ${h.unit}` : ''}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Inline styles to nail the mobile layout */}
      <style jsx>{`
        .tabbar{ display:flex; gap:18px; padding:0 2px; }
        .tab{ background:none; border:none; padding:6px 2px; font-weight:800; color:var(--muted); }
        .tab.on{ color:var(--fg); border-bottom:2px solid var(--fg); }

        .section-title{ font-weight:800; margin-bottom:8px; }
        .fav-row{ display:flex; gap:10px; overflow-x:auto; padding:4px 2px 8px; }
        .fav-row .chip{ white-space:nowrap; }

        .panel{ background:var(--card); border:1px solid var(--card-border); border-radius:18px; padding:14px; }
        .list{ display:flex; flex-direction:column; gap:10px; }
        .row{
          display:grid;
          grid-template-columns: 1fr auto auto;
          gap:10px;
          align-items:center;
          padding:8px 0;
          border-bottom:1px solid var(--card-border);
        }
        .row:last-child{ border-bottom:none; }
        .row .left{ display:flex; align-items:center; gap:12px; min-width:0; }
        .row .name{ font-weight:800; font-size:18px; word-break:break-word; }
        .row .name.done{ text-decoration:line-through; opacity:.6; }
        .row .qty{ justify-self:end; white-space:nowrap; }
        .row .rm{ justify-self:end; }

        /* History rows reuse row layout, hide checkbox */
        .row.hist{ grid-template-columns: 1fr auto; }
        .row.hist .name{ font-weight:700; }

        .add-grid{ display:grid; grid-template-columns: 1fr; gap:10px; }
        .save-wrap{ display:flex; justify-content:flex-end; margin-top:4px; }

        @media (min-width: 520px){
          .add-grid{ grid-template-columns: 1fr 140px 160px auto; align-items:end; }
          .save-wrap{ margin:0; }
        }

        /* Prevent any horizontal scrolling on mobile */
        :global(body){ overflow-x:hidden; }
      `}</style>
    </div>
  )
}
