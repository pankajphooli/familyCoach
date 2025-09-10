'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
import './calendar-ui.css'

type Member = { id: string; name: string }
type CalEvent = {
  id: string
  title: string
  description?: string | null
  date: string            // YYYY-MM-DD
  start_time?: string | null // HH:MM
  end_time?: string | null
  attendees?: string[]     // user_id[]
}

type ViewMode = 'date' | 'upcoming'

/* ---------- date helpers ---------- */
const ymd = (d: Date) => {
  const y = d.getFullYear()
  const m = `${d.getMonth()+1}`.padStart(2,'0')
  const dd = `${d.getDate()}`.padStart(2,'0')
  return `${y}-${m}-${dd}`
}
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate()+n); return c }
const mondayOfWeek = (d: Date) => {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = c.getDay() || 7
  if(day>1) c.setDate(c.getDate()-(day-1))
  return c
}
const daysSpan = (start: Date, n: number) => Array.from({length:n}, (_,i)=> ymd(addDays(start,i)))
const chipLabel = (s: string) => {
  const d = new Date(`${s}T00:00:00`)
  const w = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  return `${w} ${String(d.getDate()).padStart(2,'0')}`
}
const hhmm = (t?: string|null) => t ? t.split(':').slice(0,2).join(':') : ''
const rangeFmt = (a?: string|null, b?: string|null) => {
  const A = hhmm(a), B = hhmm(b)
  return (A||B) ? `${A} - ${B}` : ''
}

/* ---------- component ---------- */
export default function CalendarPage(){
  const supabase = useMemo(()=> createClient(), [])

  const [loading, setLoading] = useState(true)
  const [familyId, setFamilyId] = useState<string>('')

  const [members, setMembers] = useState<Member[]>([])
  const [dateChips, setDateChips] = useState<string[]>([])
  const [selDate, setSelDate] = useState<string>(ymd(new Date()))
  const [viewMode, setViewMode] = useState<ViewMode>('date')  // 'date' | 'upcoming'

  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})
  const dateInputRef = useRef<HTMLInputElement>(null)

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

      // profile → family_id
      const prof = await supabase.from('profiles').select('id, full_name, family_id').eq('id', user.id).maybeSingle()
      const fid = (prof.data?.family_id || '') as string
      setFamilyId(fid)

      // family members
      const fm = await supabase.from('family_members').select('user_id').eq('family_id', fid)
      const uids = ((fm.data||[]) as any[]).map(r=>r.user_id)
      let names: Record<string,string> = {}
      if(uids.length){
        const prs = await supabase.from('profiles').select('id, full_name').in('id', uids)
        for(const p of (prs.data||[]) as any[]){ names[p.id] = p.full_name || 'Member' }
      }
      names[user.id] = names[user.id] || prof.data?.full_name || 'Me'
      setMembers(Object.entries(names).map(([id,name])=>({id,name})))

      // build 3-month chip range (starting current Monday)
      const mon = mondayOfWeek(new Date())
      const chips = daysSpan(mon, 90)  // ~3 months / 13 weeks
      setDateChips(chips)
      if(!chips.includes(selDate)) setSelDate(ymd(new Date()))

      await loadEvents(fid, chips, uids.length ? uids.concat(user.id) : [user.id])
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  /* ---------- loader (tolerant to different table/column shapes) ---------- */
  async function loadEvents(fid: string, dates: string[], familyUserIds: string[]){
    if(!dates.length) return
    const start = dates[0], end = dates[dates.length-1]

    // try a few common table names
    const EVENT_TABLES = ['events', 'calendar_events', 'family_events']
    let rows: any[] = []
    let tableUsed: string | null = null

    // 1) by family_id
    for(const t of EVENT_TABLES){
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).eq('family_id', fid)
      if(q.error && q.status !== 406) continue
      if(q.data && q.data.length){ rows = q.data as any[]; tableUsed = t; break }
    }
    // 2) fallback by user_id (if your schema stores owner instead of family_id)
    if(!rows.length){
      for(const t of EVENT_TABLES){
        const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).in('user_id', familyUserIds)
        if(q.error && q.status !== 406) continue
        if(q.data && q.data.length){ rows = q.data as any[]; tableUsed = t; break }
      }
    }

    // optional join-table for attendees
    let attendeesByEvent: Record<string,string[]> = {}
    if(rows.length){
      const ids = rows.map(r=>r.id).filter(Boolean)
      const ea = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', ids)
      if(!ea.error && ea.data){
        for(const r of ea.data as any[]){
          (attendeesByEvent[r.event_id] ||= []).push(r.user_id)
        }
      }
    }

    // map rows to CalEvent (support many column names / timestamp strings)
    const mapRow = (r:any): CalEvent | null => {
      // extract date
      let date: string | null = r.date || r.start_date || null
      const startsAt: string | null = r.starts_at || r.start || r.start_time || r.startTime || null
      const endsAt:   string | null = r.ends_at   || r.end   || r.end_time   || r.endTime   || null
      if(!date && typeof startsAt === 'string' && startsAt.includes('T')) date = startsAt.slice(0,10)
      if(!date) return null

      let st = r.start_time || null
      let et = r.end_time || null
      if(!st && typeof startsAt === 'string'){
        const hhmm = startsAt.split('T')[1]?.slice(0,5)
        if(hhmm) st = hhmm
      }
      if(!et && typeof endsAt === 'string'){
        const hhmm = endsAt.split('T')[1]?.slice(0,5)
        if(hhmm) et = hhmm
      }

      const att = Array.isArray(r.attendees) ? r.attendees : (attendeesByEvent[r.id] || [])
      return { id: r.id, title: r.title || 'Event', description: r.description || null, date, start_time: st, end_time: et, attendees: att }
    }

    // bucket by date
    const byDate: Record<string, CalEvent[]> = {}
    for(const d of dates) byDate[d] = []
    for(const raw of rows){
      const ev = mapRow(raw); if(!ev) continue
      if(byDate[ev.date]) byDate[ev.date].push(ev)
    }
    for(const d of Object.keys(byDate)){
      byDate[d].sort((a,b)=> (a.start_time||'') < (b.start_time||'') ? -1 : 1)
    }
    setEventsByDate(byDate)
  }

  /* ---------- add event form ---------- */
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>(ymd(new Date()))
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
      const targets = ['events','calendar_events','family_events']
      let insertedId: string | null = null
      for(const t of targets){
        const ins = await supabase.from(t).insert(base).select('id').maybeSingle()
        if(!ins.error && ins.data){ insertedId = (ins.data as any).id; break }
      }
      if(!insertedId){ notify('error','Could not save event (table missing).'); return }

      if(who.length){
        await supabase.from('event_attendees').insert(who.map(uid=>({event_id: insertedId!, user_id: uid})))
      }

      setTitle(''); setDesc(''); setWho([])
      // refresh
      await loadEvents(familyId, dateChips, members.map(m=>m.id))
      notify('success','Event added')
      formTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
    }catch{ notify('error','Something went wrong while saving.') }
  }

  /* ---------- UI helpers ---------- */
  const dayEvents = eventsByDate[selDate] || []
  const today = ymd(new Date())
  const upcomingDates = dateChips.filter(d => d >= today).slice(0, 7)
  const upcomingFlat: {date:string; ev:CalEvent}[] =
    upcomingDates.flatMap(d => (eventsByDate[d]||[]).map(ev => ({date:d, ev})))

  function jumpToDate(v: string){
    if(!v) return
    setViewMode('date')
    setSelDate(v)
    // if outside current chip range, rebuild around that date
    if(!dateChips.includes(v)){
      const anchor = mondayOfWeek(new Date(v+'T00:00:00'))
      const chips = daysSpan(anchor, 90)
      setDateChips(chips)
      loadEvents(familyId, chips, members.map(m=>m.id))
    }
  }

  return (
    <div className="container cal-wrap">
      <div className="cal-head">
        <h1 className="page-title">Family Calendar</h1>
        <button className="button add-btn" onClick={()=>document.getElementById('add-form')?.scrollIntoView({behavior:'smooth'})}>Add event</button>
      </div>

      {/* Upcoming + Date chips + Jump */}
      <div className="chips">
        <button className={`chip ${viewMode==='upcoming'?'on':''}`} onClick={()=>setViewMode('upcoming')}>Upcoming</button>
        {dateChips.map(d => (
          <button key={d} className={`chip ${viewMode==='date' && selDate===d?'on':''}`} onClick={()=>{ setViewMode('date'); setSelDate(d) }}>
            {chipLabel(d)}
          </button>
        ))}
        <button className="chip" onClick={()=> dateInputRef.current?.showPicker ? dateInputRef.current.showPicker() : dateInputRef.current?.click()}>📅</button>
        <input ref={dateInputRef} type="date" className="visually-hidden" onChange={e=>jumpToDate(e.target.value)} />
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
          {dayEvents.length===0 && <div className="muted" style={{padding:'6px 2px'}}>No events for this day.</div>}
          {dayEvents.map(ev => (
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
