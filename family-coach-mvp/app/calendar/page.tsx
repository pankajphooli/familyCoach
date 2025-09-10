'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
import './calendar-ui.css'

type Member = { id: string; name: string }
type CalEvent = {
  id: string
  title: string
  description?: string | null
  date: string
  start_time?: string | null
  end_time?: string | null
  attendees?: string[]           // user_ids / names / emails
  _table?: string                // source table for edit/delete
}
type ViewMode = 'date' | 'upcoming'

/* ---------- date helpers ---------- */
const ymd = (d: Date) => {
  const y = d.getFullYear(), m = `${d.getMonth()+1}`.padStart(2,'0'), dd = `${d.getDate()}`.padStart(2,'0')
  return `${y}-${m}-${dd}`
}
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate()+n); return c }
const daysSpan = (start: Date, n: number) => Array.from({length:n}, (_,i)=> ymd(addDays(start,i)))
const chipLabel = (s: string) => {
  const d = new Date(`${s}T00:00:00`); const w = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  return `${w} ${String(d.getDate()).padStart(2,'0')}`
}
const monthYear = (s: string) => new Date(`${s}T00:00:00`)
  .toLocaleString(undefined, { month: 'long', year: 'numeric' })
const isMonthStart = (s: string) => s.slice(-2) === '01'
const hhmm = (t?: string|null) => t ? t.split(':').slice(0,2).join(':') : ''
const rangeFmt = (a?: string|null, b?: string|null) => {
  const A = hhmm(a), B = hhmm(b); return (A||B) ? `${A} - ${B}` : ''
}
const toIso = (date: string, time?: string|null) => time ? `${date}T${time}:00` : `${date}T00:00:00`

/* ---------- component ---------- */
export default function CalendarPage(){
  const supabase = useMemo(()=> createClient(), [])
  const [loading, setLoading] = useState(true)

  const [familyId, setFamilyId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])

  // Chip strip: Today + scrollable tomorrow→
  const todayStr = ymd(new Date())
  const [chipDates] = useState<string[]>(daysSpan(addDays(new Date(), 1), 180))
  const [selDate, setSelDate] = useState<string>(todayStr)
  const [viewMode, setViewMode] = useState<ViewMode>('date')

  // Month labels
  const [primaryMonth, setPrimaryMonth] = useState<string>(monthYear(todayStr))
  const [secondaryMonth, setSecondaryMonth] = useState<{label:string; x:number}|null>(null)

  // Refs
  const chipsRef = useRef<HTMLDivElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const formTopRef = useRef<HTMLDivElement>(null)

  // Events + table detection
  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})
  const [availableTables, setAvailableTables] = useState<string[]>([])
  const [primaryEventTable, setPrimaryEventTable] = useState<string | null>(null)

  // Inline edit state
  const [editEv, setEditEv] = useState<{
    id: string, table: string, title: string, date: string,
    start_time: string, end_time: string, who: string[]
  } | null>(null)
  const editRef = useRef<HTMLDivElement>(null)
  const editTitleRef = useRef<HTMLInputElement>(null)

  function notify(kind:'success'|'error', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){ (window as any).toast(kind, msg) }
    else { kind==='error' ? console.warn(msg) : console.log(msg) }
  }

  /* ---------- table detection ---------- */
  const CANDIDATE_TABLES = ['events','calendar_events','family_events','calendar','family_calendar']
  async function detectTables(): Promise<string[]>{
    const ok: string[] = []
    for(const t of CANDIDATE_TABLES){
      const res = await supabase.from(t).select('*').limit(1)
      if(!res.error) ok.push(t)
    }
    return ok
  }

  /* ---------- boot ---------- */
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ setLoading(false); return }

      // family + members (names)
      const prof = await supabase.from('profiles').select('id, full_name, family_id').eq('id', user.id).maybeSingle()
      const fid = (prof.data?.family_id || '') as string
      setFamilyId(fid)

      const fm = await supabase.from('family_members').select('user_id').eq('family_id', fid)
      const uids = ((fm.data||[]) as any[]).map(r=>r.user_id)
      const names: Record<string,string> = {}
      if(uids.length){
        const prs = await supabase.from('profiles').select('id, full_name').in('id', uids)
        for(const p of (prs.data||[]) as any[]){ names[p.id] = p.full_name || 'Member' }
      }
      names[user.id] = names[user.id] || prof.data?.full_name || 'Me'
      setMembers(Object.entries(names).map(([id,name])=>({id,name})))

      // tables
      const avail = await detectTables()
      setAvailableTables(avail)
      setPrimaryEventTable(avail[0] || 'events')

      await loadEvents(fid, Object.keys(names), todayStr)
      requestAnimationFrame(updateMonthLabels)
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  /* ---------- month labels react to scrolling ---------- */
  useEffect(()=>{
    const el = chipsRef.current; if(!el) return
    const onScroll = () => updateMonthLabels()
    el.addEventListener('scroll', onScroll, { passive:true })
    updateMonthLabels()
    return ()=> el.removeEventListener('scroll', onScroll)
  }, [chipDates])

  function updateMonthLabels(){
    const el = chipsRef.current; if(!el) return
    const left = el.scrollLeft, right = left + el.clientWidth
    const btns = Array.from(el.querySelectorAll('button[data-date]')) as HTMLButtonElement[]
    if(!btns.length) return

    // Primary = month of first overlapping chip
    let firstVisibleDate = btns[0].dataset.date!
    for(const b of btns){
      const bx1 = b.offsetLeft, bx2 = bx1 + b.offsetWidth
      const visible = bx2 > left && bx1 < right
      if(visible){ firstVisibleDate = b.dataset.date!; break }
    }
    setPrimaryMonth(monthYear(firstVisibleDate))

    // Secondary = first month-start chip that overlaps or is to the right
    let monthStartBtn: HTMLButtonElement | null = null
    for(const b of btns){
      const d = b.dataset.date!
      if(!isMonthStart(d)) continue
      const bx1 = b.offsetLeft, bx2 = bx1 + b.offsetWidth
      const overlaps = bx2 > left && bx1 < right
      if(overlaps || bx1 >= left){ monthStartBtn = b; break }
    }
    if(monthStartBtn){
      const x = Math.max(0, monthStartBtn.offsetLeft - left)
      setSecondaryMonth({ label: monthYear(monthStartBtn.dataset.date!), x })
    }else{
      setSecondaryMonth(null)
    }
  }

  /* ---------- loader: tolerant across schemas, 4m back + 12m fwd ---------- */
  async function loadEvents(fid: string, familyUserIds: string[], anchorDate: string){
    const start = ymd(addDays(new Date(anchorDate+'T00:00:00'), -120))
    const end   = ymd(addDays(new Date(anchorDate+'T00:00:00'),  365))

    const rows: { row:any; table:string }[] = []
    const tables = availableTables.length ? availableTables : CANDIDATE_TABLES

    // family_id
    for(const t of tables){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).eq('family_id', fid)
      if(!q.error && q.data) rows.push(...(q.data as any[]).map(r=>({row:r, table:t})))
    }
    // user_id
    for(const t of tables){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).in('user_id', familyUserIds)
      if(!q.error && q.data) rows.push(...(q.data as any[]).map(r=>({row:r, table:t})))
    }
    // starts_at timestamps
    for(const t of tables){
      const q = await supabase.from(t).select('*')
        .gte('starts_at', `${start}T00:00:00`).lte('starts_at', `${end}T23:59:59`)
      if(!q.error && q.data) rows.push(...(q.data as any[]).map(r=>({row:r, table:t})))
    }
    // plain date
    for(const t of tables){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end)
      if(!q.error && q.data) rows.push(...(q.data as any[]).map(r=>({row:r, table:t})))
    }

    // attendees joins (event_attendees + calendar_attendees)
    const ids = rows.map(x=>x.row.id).filter(Boolean)
    const attendeesByEvent: Record<string,string[]> = {}
    if(ids.length){
      const ea = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', ids)
      if(!ea.error && ea.data){ for(const r of ea.data as any[]){ (attendeesByEvent[r.event_id] ||= []).push(r.user_id) } }
      const ea2 = await supabase.from('calendar_attendees').select('event_id,user_id').in('event_id', ids)
      if(!ea2.error && ea2.data){ for(const r of ea2.data as any[]){ (attendeesByEvent[r.event_id] ||= []).push(r.user_id) } }
    }

    const coerceAttendees = (r:any): string[] => {
      // prefer join tables
      if(attendeesByEvent[r.id]?.length) return Array.from(new Set(attendeesByEvent[r.id]))
      // array-ish columns (attendees/participants/member_ids)
      const candCols = ['attendees','participants','member_ids']
      for(const c of candCols){
        if(Array.isArray(r[c])) return (r[c] as any[]).map((x:any)=>String(x))
        if(typeof r[c] === 'string'){
          const list = String(r[c]).split(/[,;]+/).map(s=>s.trim()).filter(Boolean)
          if(list.length) return list
        }
      }
      // fallback to creator
      if(r.user_id) return [String(r.user_id)]
      return []
    }

    const mapRow = (r:any, table:string): CalEvent | null => {
      let date: string | null = r.date || r.start_date || null
      const startsAt: string | null = r.starts_at || r.start || r.start_time || r.startTime || null
      const endsAt:   string | null = r.ends_at   || r.end   || r.end_time   || r.endTime   || null
      if(!date && typeof startsAt === 'string' && startsAt.includes('T')) date = startsAt.slice(0,10)
      if(!date) return null
      let st = r.start_time || null, et = r.end_time || null
      if(!st && typeof startsAt === 'string'){ const hh = startsAt.split('T')[1]?.slice(0,5); if(hh) st = hh }
      if(!et && typeof endsAt   === 'string'){ const hh = endsAt.split('T')[1]?.slice(0,5);   if(hh) et = hh }
      const att = coerceAttendees(r)
      return { id: r.id, _table: table, title: r.title || 'Event', description: r.description || null, date, start_time: st, end_time: et, attendees: att }
    }

    const keyset = new Set<string>()
    const byDate: Record<string, CalEvent[]> = {}
    for(const {row, table} of rows){
      const ev = mapRow(row, table); if(!ev) continue
      if(ev.date < start || ev.date > end) continue
      const K = `${ev._table}|${ev.id}|${ev.date}`; if(keyset.has(K)) continue; keyset.add(K)
      ;(byDate[ev.date] ||= []).push(ev)
    }
    for(const d of Object.keys(byDate)){ byDate[d].sort((a,b)=> (a.start_time||'') < (b.start_time||'') ? -1 : 1) }
    setEventsByDate(byDate)
  }

  /* ---------- add, edit, delete ---------- */
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>(todayStr)
  const [startTime, setStartTime] = useState<string>('09:00'); const [endTime, setEndTime] = useState<string>('10:00')
  const [who, setWho] = useState<string[]>([])
  const toggleWho = (id: string) => setWho(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])

  const tryInsert = async (table: string, payloads: any[]): Promise<string | null> => {
    for(const p of payloads){
      const ins = await supabase.from(table).insert(p).select('id').maybeSingle()
      if(!ins.error && ins.data) return (ins.data as any).id as string
    }
    return null
  }

  async function onAdd(){
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ notify('error','Sign in first'); return }
      if(!title.trim()){ notify('error','Add a title'); return }

      const base = { title: title.trim(), description: desc || null }
      const d = date
      const variants = [
        { ...base, date: d, start_time: startTime, end_time: endTime, family_id: familyId || null, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime), ends_at: toIso(d, endTime), family_id: familyId || null, user_id: user.id },
        { ...base, date: d, start_time: startTime, end_time: endTime, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime), ends_at: toIso(d, endTime), user_id: user.id },
        { ...base, date: d }
      ]

      const targets = primaryEventTable ? [primaryEventTable, ...CANDIDATE_TABLES] : CANDIDATE_TABLES
      let insertedId: string | null = null
      let usedTable: string | null = null
      for(const t of targets){
        insertedId = await tryInsert(t, variants)
        if(insertedId){ usedTable = t; setPrimaryEventTable(t); break }
      }
      if(!insertedId || !usedTable){ notify('error','Could not save event (no compatible table).'); return }

      // Try to persist attendees on the row (if column exists)
      const up = await supabase.from(usedTable).update({ attendees: who } as any).eq('id', insertedId)
      // ignore up.error if column doesn't exist

      // Also write to join table (best-effort)
      if(who.length){
        const insEA = await supabase.from('event_attendees').insert(who.map(uid=>({event_id: insertedId!, user_id: uid})))
        // ignore insEA.error if table doesn't exist
      }

      setTitle(''); setDesc(''); setWho([])
      await loadEvents(familyId, members.map(m=>m.id), d)
      setViewMode('date'); setSelDate(d)
      notify('success','Event added')
      formTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
    }catch(e){ console.warn(e); notify('error','Something went wrong while saving.') }
  }

  function openEdit(ev: CalEvent){
    setEditEv({
      id: ev.id,
      table: ev._table || primaryEventTable || 'events',
      title: ev.title || '',
      date: ev.date,
      start_time: ev.start_time || '',
      end_time: ev.end_time || '',
      who: (ev.attendees||[]).slice(0)
    })
  }
  // After editEv appears, scroll to it and focus title
  useEffect(()=>{
    if(!editEv) return
    const t = setTimeout(()=>{
      editRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
      editTitleRef.current?.focus()
    }, 50)
    return ()=> clearTimeout(t)
  }, [editEv])

  async function onSaveEdit(){
    if(!editEv) return
    try{
      const t = editEv.table
      const id = editEv.id
      // attempt both column models
      const p1 = { title: editEv.title, description: null, date: editEv.date, start_time: editEv.start_time || null, end_time: editEv.end_time || null }
      const p2 = { title: editEv.title, description: null, date: editEv.date, starts_at: toIso(editEv.date, editEv.start_time||null), ends_at: toIso(editEv.date, editEv.end_time||null) }

      let ok = false
      const r1 = await supabase.from(t).update(p1 as any).eq('id', id)
      if(!r1.error){ ok = true } else {
        const r2 = await supabase.from(t).update(p2 as any).eq('id', id)
        if(!r2.error) ok = true
      }
      if(!ok){ notify('error','Could not update event.'); return }

      // Replace attendees (row array + join table)
      const upd = await supabase.from(t).update({ attendees: editEv.who } as any).eq('id', id)
      // ignore upd.error
      await supabase.from('event_attendees').delete().eq('event_id', id)
      if(editEv.who.length){ await supabase.from('event_attendees').insert(editEv.who.map(uid=>({event_id:id, user_id:uid}))) }

      await loadEvents(familyId, members.map(m=>m.id), editEv.date)
      setSelDate(editEv.date); setViewMode('date'); setEditEv(null)
      notify('success','Event updated')
    }catch(e){ console.warn(e); notify('error','Update failed.') }
  }

  async function onDelete(ev: CalEvent){
    try{
      const t = ev._table || primaryEventTable || 'events'
      const del = await supabase.from(t).delete().eq('id', ev.id)
      if(del.error){ notify('error','Delete failed.'); return }
      await supabase.from('event_attendees').delete().eq('event_id', ev.id) // ignore errors
      await loadEvents(familyId, members.map(m=>m.id), selDate)
      notify('success','Event deleted')
    }catch(e){ console.warn(e); notify('error','Delete failed.') }
  }

  /* ---------- Today behavior ---------- */
  function onTodayClick(){
    setViewMode('date')
    setSelDate(todayStr)
    requestAnimationFrame(() => chipsRef.current?.scrollTo({ left: 0, behavior: 'smooth' }))
  }

  /* ---------- display helpers ---------- */
  const nameFor = (att: string) => {
    const m = members.find(x => x.id === att)
    if(m) return m.name
    if(att.includes('@')) return att.split('@')[0] // email → local part
    return att
  }

  /* ---------- computed ---------- */
  const upcomingFlat3m = (() => {
    const start = todayStr
    const end3 = ymd(addDays(new Date(todayStr+'T00:00:00'), 90))
    const dates = Object.keys(eventsByDate).filter(d => d >= start && d <= end3).sort()
    return dates.flatMap(d => (eventsByDate[d]||[]).map(ev => ({date:d, ev})))
  })()

  return (
    <div className="container cal-wrap">
      <div className="cal-head">
        <h1 className="page-title">Family Calendar</h1>
        <button className="button add-btn" onClick={()=>document.getElementById('add-form')?.scrollIntoView({behavior:'smooth'})}>Add event</button>
      </div>

      {/* Month labels (primary sticky, secondary moves with 1st-of-month chip) */}
      <div className="monthbar">
        <div className="monthlbls">
          <span className="monthtag primary">{primaryMonth}</span>
          {secondaryMonth && (
            <span className="monthtag secondary" style={{ left: `${secondaryMonth.x}px` }}>{secondaryMonth.label}</span>
          )}
        </div>
      </div>

      {/* Single SCROLLABLE strip: 📅, Upcoming, Today, and all dates (Today becomes sticky via CSS) */}
      <div className="chips sticky-today" ref={chipsRef}>
        {/* Calendar picker */}
        <button className="chip" onClick={() => (dateInputRef.current?.showPicker ? dateInputRef.current.showPicker() : dateInputRef.current?.click())}>📅</button>
        <input ref={dateInputRef} type="date" className="visually-hidden" onChange={async e=>{
          const v = e.target.value; if(!v) return
          setViewMode('date'); setSelDate(v)
          await loadEvents(familyId, members.map(m=>m.id), v)
          requestAnimationFrame(updateMonthLabels)
        }} />

        {/* Upcoming (3 months) */}
        <button className={`chip ${viewMode==='upcoming'?'on':''}`} onClick={()=>setViewMode('upcoming')}>Upcoming</button>

        {/* TODAY */}
        <button className={`chip today ${viewMode==='date' && selDate===todayStr ? 'on':''}`} onClick={onTodayClick}>Today</button>

        {/* Dates: tomorrow onward */}
        {chipDates.map(d => (
          <button
            key={d}
            data-date={d}
            className={`chip ${viewMode==='date' && selDate===d?'on':''}`}
            onClick={async ()=>{ setViewMode('date'); setSelDate(d); await loadEvents(familyId, members.map(m=>m.id), d); requestAnimationFrame(updateMonthLabels) }}
          >
            {chipLabel(d)}
          </button>
        ))}
      </div>

      {/* Events */}
      {viewMode==='upcoming' ? (
        <section className="panel">
          {upcomingFlat3m.length===0 && <div className="muted" style={{padding:'6px 2px'}}>No upcoming events in the next 3 months.</div>}
          {upcomingFlat3m.map(({date, ev}) => (
            <div key={`${ev._table||'t'}:${ev.id}:${date}`} className="ev-row">
              <div className="ev-title">{ev.title || 'Event'}</div>
              <div className="ev-time">{chipLabel(date)} · {rangeFmt(ev.start_time, ev.end_time)}</div>
              <div className="ev-people">
                {(ev.attendees||[]).map(a => (<span key={a}>{nameFor(a)}</span>))}
              </div>
              <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
                <button className="button-outline" onClick={()=>openEdit(ev)}>Edit</button>
                <button className="button-outline" onClick={()=>onDelete(ev)}>Delete</button>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="panel">
          {(eventsByDate[selDate]||[]).length===0 && <div className="muted" style={{padding:'6px 2px'}}>No events for this day.</div>}
          {(eventsByDate[selDate]||[]).map(ev => (
            <div key={`${ev._table||'t'}:${ev.id}`} className="ev-row">
              <div className="ev-title">{ev.title || 'Event'}</div>
              <div className="ev-time">{rangeFmt(ev.start_time, ev.end_time)}</div>
              <div className="ev-people">
                {(ev.attendees||[]).map(a => (<span key={a}>{nameFor(a)}</span>))}
              </div>
              <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
                <button className="button-outline" onClick={()=>openEdit(ev)}>Edit</button>
                <button className="button-outline" onClick={()=>onDelete(ev)}>Delete</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Add event */}
      <section id="add-form" className="panel form" ref={formTopRef}>
        <h3 className="form-title">Add Event</h3>

        <input className="line-input" placeholder="Event Title" value={title} onChange={e=>setTitle(e.target.value)} />
        <input className="line-input" placeholder="Event Description" value={desc} onChange={e=>setDesc(e.target.value)} />

        <div className="grid-3">
          <div>
            <div className="lbl">Date</div>
            <input type="date" className="pill-input" value={date} onChange={e=>setDate(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Start Time</div>
            <input type="time" className="pill-input" value={startTime} onChange={e=>setStartTime(e.target.value)} />
          </div>
          <div>
            <div className="lbl">End Time</div>
            <input type="time" className="pill-input" value={endTime} onChange={e=>setEndTime(e.target.value)} />
          </div>
        </div>

        <div style={{marginTop:10}}>
          <div className="lbl">Attendees</div>
          <div className="chips wrap">
            {members.map(m => (
              <button key={m.id} className={`chip ${who.includes(m.id)?'on':''}`} onClick={()=>toggleWho(m.id)} type="button">
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <div className="actions">
          <button className="button" onClick={onAdd}>Save Event</button>
        </div>
      </section>

      {/* Inline edit panel */}
      {editEv && (
        <section className="panel form" ref={editRef} style={{marginTop:12}}>
          <h3 className="form-title">Edit Event</h3>
          <input ref={editTitleRef} className="line-input" placeholder="Event Title" value={editEv.title} onChange={e=>setEditEv({...editEv!, title:e.target.value})} />
          <div className="grid-3">
            <div>
              <div className="lbl">Date</div>
              <input type="date" className="pill-input" value={editEv.date} onChange={e=>setEditEv({...editEv!, date:e.target.value})} />
            </div>
            <div>
              <div className="lbl">Start Time</div>
              <input type="time" className="pill-input" value={editEv.start_time} onChange={e=>setEditEv({...editEv!, start_time:e.target.value})} />
            </div>
            <div>
              <div className="lbl">End Time</div>
              <input type="time" className="pill-input" value={editEv.end_time} onChange={e=>setEditEv({...editEv!, end_time:e.target.value})} />
            </div>
          </div>
          <div style={{marginTop:10}}>
            <div className="lbl">Attendees</div>
            <div className="chips wrap">
              {members.map(m => {
                const active = editEv.who.includes(m.id)
                return (
                  <button
                    key={m.id}
                    className={`chip ${active?'on':''}`}
                    onClick={()=> {
                      const has = editEv!.who.includes(m.id)
                      setEditEv({...editEv!, who: has ? editEv!.who.filter(x=>x!==m.id) : [...editEv!.who, m.id]})
                    }}
                    type="button"
                  >
                    {m.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="actions" style={{gap:8}}>
            <button className="button-outline" onClick={()=>setEditEv(null)}>Cancel</button>
            <button className="button" onClick={onSaveEdit}>Save changes</button>
          </div>
        </section>
      )}

      {loading && <div className="muted" style={{marginTop:8}}>Loading…</div>}
    </div>
  )
}
