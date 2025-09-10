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
  attendees?: string[]
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
const isMonthStart = (s: string) => s.endsWith('-01')
const hhmm = (t?: string|null) => t ? t.split(':').slice(0,2).join(':') : ''
const rangeFmt = (a?: string|null, b?: string|null) => {
  const A = hhmm(a), B = hhmm(b); return (A||B) ? `${A} - ${B}` : ''
}

/* ---------- component ---------- */
export default function CalendarPage(){
  const supabase = useMemo(()=> createClient(), [])
  const [loading, setLoading] = useState(true)

  const [familyId, setFamilyId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])

  // Chips now begin *tomorrow*, with Today as its own chip.
  const todayStr = ymd(new Date())
  const [chipDates, setChipDates] = useState<string[]>(daysSpan(addDays(new Date(), 1), 180)) // ~6 months for safety
  const [selDate, setSelDate] = useState<string>(todayStr)
  const [viewMode, setViewMode] = useState<ViewMode>('date')

  // Month labels: primary (sticky left) + secondary (moves with first day of next month)
  const [primaryMonth, setPrimaryMonth] = useState<string>(monthYear(todayStr))
  const [secondaryMonth, setSecondaryMonth] = useState<{label:string; x:number}|null>(null)

  const chipsRef = useRef<HTMLDivElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})
  const [eventTable, setEventTable] = useState<string | null>(null)

  function notify(kind:'success'|'error', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){ (window as any).toast(kind, msg) }
    else { kind==='error' ? console.warn(msg) : console.log(msg) }
  }

  /* ---------- boot ---------- */
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ setLoading(false); return }

      // family & members
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

      await loadEvents(fid, chipDates, Object.keys(names))
      // initialize month labels based on initial scroll (leftmost visible chip)
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

    // Primary label = month of the first *visible* chip (any overlap)
    let firstVisibleDate = btns[0].dataset.date!
    for(const b of btns){
      const bx1 = b.offsetLeft, bx2 = bx1 + b.offsetWidth
      if(bx2 > left && bx1 < right){ firstVisibleDate = b.dataset.date!; break }
    }
    setPrimaryMonth(monthYear(firstVisibleDate))

    // Secondary label = next month-start chip position (moves with that chip, sticks when off-screen)
    let nextMonthBtn: HTMLButtonElement | null = null
    for(const b of btns){
      if(isMonthStart(b.dataset.date!) && b.offsetLeft > left + 8){
        nextMonthBtn = b; break
      }
    }
    if(nextMonthBtn){
      const x = Math.max(0, nextMonthBtn.offsetLeft - left) // position inside viewport
      setSecondaryMonth({ label: monthYear(nextMonthBtn.dataset.date!), x })
    }else{
      setSecondaryMonth(null)
    }
  }

  /* ---------- tolerant loader (family_id, user_id, starts_at timestamps, plain date) ---------- */
  async function loadEvents(fid: string, dates: string[], familyUserIds: string[]){
    if(!dates.length) return
    const start = todayStr
    const end   = dates[dates.length-1]

    const EVENT_TABLES = ['events','calendar_events','family_events','calendar','family_calendar']
    let rows: any[] = []
    let used: string | null = null

    // by family_id
    for(const t of EVENT_TABLES){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).eq('family_id', fid)
      if(q.data && q.data.length){ rows = rows.concat(q.data as any[]); used = used || t }
    }
    // by user_id
    for(const t of EVENT_TABLES){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).in('user_id', familyUserIds)
      if(q.data && q.data.length){ rows = rows.concat(q.data as any[]); used = used || t }
    }
    // by starts_at timestamps
    for(const t of EVENT_TABLES){
      const q = await supabase.from(t).select('*')
        .gte('starts_at', `${start}T00:00:00`).lte('starts_at', `${end}T23:59:59`)
      if(q.data && q.data.length){ rows = rows.concat(q.data as any[]); used = used || t }
    }
    // plain date (no family/user filter) as last resort
    for(const t of EVENT_TABLES){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end)
      if(q.data && q.data.length){ rows = rows.concat(q.data as any[]); used = used || t }
    }

    setEventTable(used)

    // attendees join
    const ids = rows.map(r=>r.id).filter(Boolean)
    let attendeesByEvent: Record<string,string[]> = {}
    if(ids.length){
      const ea = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', ids)
      if(!ea.error && ea.data){
        for(const r of ea.data as any[]){ (attendeesByEvent[r.event_id] ||= []).push(r.user_id) }
      }
    }

    const mapRow = (r:any): CalEvent | null => {
      let date: string | null = r.date || r.start_date || null
      const startsAt: string | null = r.starts_at || r.start || r.start_time || r.startTime || null
      const endsAt:   string | null = r.ends_at   || r.end   || r.end_time   || r.endTime   || null
      if(!date && typeof startsAt === 'string' && startsAt.includes('T')) date = startsAt.slice(0,10)
      if(!date) return null
      let st = r.start_time || null, et = r.end_time || null
      if(!st && typeof startsAt === 'string'){ const hh = startsAt.split('T')[1]?.slice(0,5); if(hh) st = hh }
      if(!et && typeof endsAt   === 'string'){ const hh = endsAt.split('T')[1]?.slice(0,5);   if(hh) et = hh }
      const att = Array.isArray(r.attendees) ? r.attendees : (attendeesByEvent[r.id] || [])
      return { id: r.id, title: r.title || 'Event', description: r.description || null, date, start_time: st, end_time: et, attendees: att }
    }

    const keyset = new Set<string>()
    const byDate: Record<string, CalEvent[]> = {}; for(const d of [todayStr, ...dates]) byDate[d] = []
    for(const raw of rows){
      const ev = mapRow(raw); if(!ev) continue
      if(ev.date < todayStr || ev.date > end) continue
      const K = `${ev.id}|${ev.date}`; if(keyset.has(K)) continue; keyset.add(K)
      if(byDate[ev.date]) byDate[ev.date].push(ev)
    }
    for(const d of Object.keys(byDate)){ byDate[d].sort((a,b)=> (a.start_time||'') < (b.start_time||'') ? -1 : 1) }
    setEventsByDate(byDate)
  }

  /* ---------- add event ---------- */
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>(todayStr)
  const [startTime, setStartTime] = useState<string>('09:00'); const [endTime, setEndTime] = useState<string>('10:00')
  const [who, setWho] = useState<string[]>([])
  const formTopRef = useRef<HTMLDivElement>(null)
  const toggleWho = (id: string) => setWho(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])

  async function onAdd(){
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ notify('error','Sign in first'); return }
      if(!familyId){ notify('error','No family found'); return }
      if(!title.trim()){ notify('error','Add a title'); return }

      const base = { title: title.trim(), description: desc||null, date, start_time: startTime, end_time: endTime, family_id: familyId }

      let insertedId: string | null = null
      if(eventTable){
        const ins = await supabase.from(eventTable).insert(base).select('id').maybeSingle()
        if(!ins.error && ins.data) insertedId = (ins.data as any).id
      }
      if(!insertedId){
        const targets = ['events','calendar_events','family_events','calendar','family_calendar']
        for(const t of targets){
          const ins = await supabase.from(t).insert(base).select('id').maybeSingle()
          if(!ins.error && ins.data){ insertedId = (ins.data as any).id; break }
        }
      }
      if(!insertedId){ notify('error','Could not save event (table missing).'); return }

      if(who.length){ await supabase.from('event_attendees').insert(who.map(uid=>({event_id: insertedId!, user_id: uid}))) }

      setTitle(''); setDesc(''); setWho([])
      await loadEvents(familyId, chipDates, members.map(m=>m.id))
      setViewMode('date'); setSelDate(date)
      notify('success','Event added')
      formTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
    }catch{ notify('error','Something went wrong while saving.') }
  }

  /* ---------- computed ---------- */
  const upcomingFlat =
    [todayStr, ...chipDates].slice(0, 8) // today + next 7
      .flatMap(d => (eventsByDate[d]||[]).map(ev => ({date:d, ev})))

  return (
    <div className="container cal-wrap">
      <div className="cal-head">
        <h1 className="page-title">Family Calendar</h1>
        <button className="button add-btn" onClick={()=>document.getElementById('add-form')?.scrollIntoView({behavior:'smooth'})}>Add event</button>
      </div>

      {/* Month labels */}
      <div className="monthbar">
        <div className="monthlbls">
          <span className="monthtag primary">{primaryMonth}</span>
          {secondaryMonth && (
            <span className="monthtag secondary" style={{ left: `${secondaryMonth.x}px` }}>{secondaryMonth.label}</span>
          )}
        </div>
      </div>

      {/* Chips: 📅, Upcoming, Today, then Tomorrow+ */}
      <div className="chips" ref={chipsRef}>
        <button className="chip" onClick={()=> (dateInputRef.current?.showPicker ? dateInputRef.current.showPicker() : dateInputRef.current?.click())}>📅</button>
        <input ref={dateInputRef} type="date" className="visually-hidden" onChange={e=>{
          const v = e.target.value; if(!v) return
          setViewMode('date'); setSelDate(v)
          // if jump is beyond current list, rebuild from that date+1 for 180 days
          if(v > chipDates[chipDates.length-1]){
            const next = daysSpan(addDays(new Date(v+'T00:00:00'), 1), 180)
            setChipDates(next)
          }
          requestAnimationFrame(updateMonthLabels)
        }} />
        <button className={`chip ${viewMode==='upcoming'?'on':''}`} onClick={()=>setViewMode('upcoming')}>Upcoming</button>
        <button className={`chip ${viewMode==='date' && selDate===todayStr?'on':''}`} onClick={()=>{ setViewMode('date'); setSelDate(todayStr); requestAnimationFrame(updateMonthLabels) }}>Today</button>
        {chipDates.map(d => (
          <button key={d} data-date={d} className={`chip ${viewMode==='date' && selDate===d?'on':''}`} onClick={()=>{ setViewMode('date'); setSelDate(d); requestAnimationFrame(updateMonthLabels) }}>
            {chipLabel(d)}
          </button>
        ))}
      </div>

      {/* Events */}
      {viewMode==='upcoming' ? (
        <section className="panel">
          {upcomingFlat.length===0 && <div className="muted" style={{padding:'6px 2px'}}>No upcoming events in the next week.</div>}
          {upcomingFlat.map(({date, ev}) => (
            <div key={ev.id} className="ev-row">
              <div className="ev-title">{ev.title || 'Event'}</div>
              <div className="ev-time">{chipLabel(date)} · {rangeFmt(ev.start_time, ev.end_time)}</div>
              <div className="ev-people">
                {(ev.attendees||[]).map(uid => (<span key={uid}>{(members.find(m=>m.id===uid)?.name)||'Member'}</span>))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="panel">
          {(eventsByDate[selDate]||[]).length===0 && <div className="muted" style={{padding:'6px 2px'}}>No events for this day.</div>}
          {(eventsByDate[selDate]||[]).map(ev => (
            <div key={ev.id} className="ev-row">
              <div className="ev-title">{ev.title || 'Event'}</div>
              <div className="ev-time">{rangeFmt(ev.start_time, ev.end_time)}</div>
              <div className="ev-people">
                {(ev.attendees||[]).map(uid => (<span key={uid}>{(members.find(m=>m.id===uid)?.name)||'Member'}</span>))}
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

      {loading && <div className="muted" style={{marginTop:8}}>Loading…</div>}
    </div>
  )
}
