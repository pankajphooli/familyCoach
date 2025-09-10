'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'
import './calendar-ui.css'

type Profile = { id: string; full_name?: string | null; family_id?: string | null }
type Member = { id: string; name: string }
type CalEvent = {
  id: string
  title: string
  description?: string | null
  date: string            // YYYY-MM-DD
  start_time?: string | null // HH:MM (or HH:MM:SS)
  end_time?: string | null
  attendees?: string[]     // user_id[]
}

function ymd(d: Date){
  const y = d.getFullYear()
  const m = `${d.getMonth()+1}`.padStart(2,'0')
  const dd = `${d.getDate()}`.padStart(2,'0')
  return `${y}-${m}-${dd}`
}
function mondayOfWeek(d: Date){
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = c.getDay() || 7
  if(day>1) c.setDate(c.getDate()-(day-1))
  return c
}
function rangeMonToSun(monday: Date){
  const out: string[] = []
  for(let i=0;i<7;i++){ const d = new Date(monday); d.setDate(monday.getDate()+i); out.push(ymd(d)) }
  return out
}
function chipLabel(s: string){
  const d = new Date(`${s}T00:00:00`)
  const w = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  return `${w} ${String(d.getDate()).padStart(2,'0')}`
}
function fmtTime(t?: string | null){
  if(!t) return ''
  const [hh,mm] = t.split(':')
  return `${hh}:${mm}`
}
function fmtRange(a?: string|null, b?: string|null){
  const A = fmtTime(a), B = fmtTime(b)
  return (A||B) ? `${A} - ${B}` : ''
}

export default function CalendarPage(){
  const supabase = useMemo(()=> createClient(), [])
  const [loading, setLoading] = useState(true)

  const [familyId, setFamilyId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [weekDates, setWeekDates] = useState<string[]>([])
  const [selDate, setSelDate] = useState<string>(ymd(new Date()))
  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})

  // form state
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>(ymd(new Date()))
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('10:00')
  const [who, setWho] = useState<string[]>([])
  const formRef = useRef<HTMLDivElement>(null)

  function notify(kind:'success'|'error', msg:string){
    if(typeof window !== 'undefined' && (window as any).toast){ (window as any).toast(kind, msg) }
    else { kind==='error' ? console.warn(msg) : console.log(msg) }
  }

  // ---------- load family + members + week ----------
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ setLoading(false); return }

      // current profile → family_id
      const prof = await supabase.from('profiles').select('id, full_name, family_id').eq('id', user.id).maybeSingle()
      const fid = (prof.data?.family_id || '') as string
      setFamilyId(fid)

      // family members (fetch names separately for reliability)
      const fm = await supabase.from('family_members').select('user_id').eq('family_id', fid)
      const uids = ((fm.data||[]) as any[]).map(r=>r.user_id)
      let names: Record<string,string> = {}
      if(uids.length){
        const prs = await supabase.from('profiles').select('id, full_name').in('id', uids)
        for(const p of (prs.data||[]) as any[]){ names[p.id] = p.full_name || 'Member' }
      }
      // always include current user as member (owner)
      names[user.id] = prof.data?.full_name || names[user.id] || 'Me'
      const mems: Member[] = Object.entries(names).map(([id, name])=>({id, name}))
      setMembers(mems)

      // week range
      const mon = mondayOfWeek(new Date())
      const dates = rangeMonToSun(mon)
      setWeekDates(dates)
      if(!dates.includes(selDate)) setSelDate(dates[0])

      await loadEvents(fid, dates, mems)
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  async function loadEvents(fid: string, dates: string[], mems: Member[]){
    if(!fid || !dates.length) return
    const start = dates[0], end = dates[dates.length-1]
    const tableCandidates = ['events', 'calendar_events', 'family_events']

    let tableFound = ''
    let rows: any[] = []
    for(const t of tableCandidates){
      const q = await supabase.from(t).select('id,title,description,date,start_time,end_time,attendees,family_id').gte('date', start).lte('date', end).eq('family_id', fid)
      if(q.error && q.status !== 406){ continue } // try next table
      if(q.data){ tableFound = t; rows = q.data as any[]; break }
    }

    // optional attendees join-table support
    let attendeesByEvent: Record<string,string[]> = {}
    if(rows.length){
      const ids = rows.map(r=>r.id)
      const ea = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', ids)
      if(!ea.error && ea.data){
        for(const r of ea.data as any[]){
          const list = attendeesByEvent[r.event_id] || []
          list.push(r.user_id)
          attendeesByEvent[r.event_id] = list
        }
      }
    }

    // build by-date map
    const nameById: Record<string,string> = Object.fromEntries(mems.map(m=>[m.id, m.name]))
    const byDate: Record<string, CalEvent[]> = {}
    for(const d of dates) byDate[d] = []

    for(const r of rows){
      const ids: string[] =
        (Array.isArray(r.attendees) && r.attendees.length) ? r.attendees :
        (attendeesByEvent[r.id] || [])
      const ev: CalEvent = {
        id: r.id,
        title: r.title || 'Event',
        description: r.description || null,
        date: r.date,
        start_time: r.start_time, end_time: r.end_time,
        attendees: ids
      }
      if(byDate[ev.date]) byDate[ev.date].push(ev)
    }
    // sort by time
    for(const d of Object.keys(byDate)){
      byDate[d].sort((a,b)=> (a.start_time||'') < (b.start_time||'') ? -1 : 1)
    }
    setEventsByDate(byDate)
  }

  // ---------- add event ----------
  function toggleWho(id: string){
    setWho(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  }

  async function onAdd(){
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ notify('error','Sign in first'); return }
      if(!familyId){ notify('error','No family found'); return }
      if(!title.trim()){ notify('error','Add a title'); return }

      const base = { title: title.trim(), description: desc||null, date, start_time: startTime, end_time: endTime, family_id: familyId }
      // try main tables in order
      const targets = ['events','calendar_events','family_events']
      let insertedId: string | null = null
      for(const t of targets){
        const ins = await supabase.from(t).insert(base).select('id').maybeSingle()
        if(!ins.error && ins.data){ insertedId = (ins.data as any).id; break }
      }
      if(!insertedId){ notify('error','Could not save event (missing table).'); return }

      // save attendees if join-table exists
      if(who.length){
        const payload = who.map(uid=>({ event_id: insertedId!, user_id: uid }))
        const ea = await supabase.from('event_attendees').insert(payload)
        // ignore error if table not present
      }

      // clear + reload
      setTitle(''); setDesc(''); setWho([])
      const mon = mondayOfWeek(new Date())
      const dates = rangeMonToSun(mon)
      await loadEvents(familyId, dates, members)
      notify('success','Event added')
      // scroll back to top of list
      if(formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }catch(e){ notify('error','Something went wrong while saving.') }
  }

  const dayEvents = eventsByDate[selDate] || []

  return (
    <div className="container cal-wrap">
      <div className="cal-head">
        <h1 className="page-title">Family Calendar</h1>
        <button className="button add-btn" onClick={()=>document.getElementById('add-form')?.scrollIntoView({behavior:'smooth'})}>Add event</button>
      </div>

      {/* Date chips */}
      <div className="chips">
        {weekDates.map(d => (
          <button key={d} className={`chip ${selDate===d?'on':''}`} onClick={()=>setSelDate(d)}>
            {chipLabel(d)}
          </button>
        ))}
      </div>

      {/* Events list */}
      <section className="panel" ref={formRef}>
        {dayEvents.length===0 && <div className="muted" style={{padding:'6px 2px'}}>No events for this day.</div>}
        {dayEvents.map(ev => (
          <div key={ev.id} className="ev-row">
            <div className="ev-title">{ev.title || 'Event'}</div>
            <div className="ev-time">{fmtRange(ev.start_time, ev.end_time)}</div>
            <div className="ev-people">
              {(ev.attendees||[]).map(uid => (<span key={uid}>{(members.find(m=>m.id===uid)?.name)||'Member'}</span>))}
            </div>
          </div>
        ))}
      </section>

      {/* Add event */}
      <section id="add-form" className="panel form">
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
              <button
                key={m.id}
                className={`chip ${who.includes(m.id)?'on':''}`}
                onClick={()=>toggleWho(m.id)}
                type="button"
              >
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
