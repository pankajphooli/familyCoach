'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabaseClient'

type Member = { user_id: string, email: string | null, full_name: string | null }
type Event = any

export default function Calendar(){
  const supabase = createClient()
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [events, setEvents] = useState<Event[]>([])

  // Form state
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>('')
  const [start, setStart] = useState<string>('09:00')
  const [end, setEnd] = useState<string>('10:00')
  const [allDay, setAllDay] = useState(false)
  const [recType, setRecType] = useState<'NONE'|'DAILY'|'WEEKLY'|'MONTHLY'>('NONE')
  const [byWeekday, setByWeekday] = useState<string[]>([])
  const [attendeeIds, setAttendeeIds] = useState<string[]>([])

  // Colors per member
  const colors = ['#60a5fa','#a78bfa','#34d399','#f472b6','#f59e0b','#22d3ee']
  const colorFor = (uid: string) => {
    const idx = members.map(m=>m.user_id).sort().indexOf(uid)
    return colors[idx % colors.length]
  }

  const loadFamily = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('family_id').eq('id', user.id).maybeSingle()
    if (!profile?.family_id) return
    setFamilyId(profile.family_id)

    // Members (1-1 relation to profiles). Cast to any[] to avoid TS narrowing issues for nested selects.
    const { data: memsRaw } = await supabase.from('family_members')
      .select('user_id, role, profiles:profiles ( full_name )')
      .eq('family_id', profile.family_id)
    const mems: any[] = (memsRaw as any[]) || []
    const enriched: Member[] = mems.map((m:any) => {
      const p = m.profiles
      const fullName = Array.isArray(p) ? (p[0]?.full_name ?? null) : (p?.full_name ?? null)
      return { user_id: m.user_id, email: null, full_name: fullName }
    })
    setMembers(enriched)

    // Events for next 60 days
    const from = new Date(); const to = new Date(); to.setDate(to.getDate()+60)
    const { data: evs } = await supabase.from('calendar_events')
      .select('*, event_attendees ( user_id )')
      .eq('family_id', profile.family_id)
      .gte('start_ts', from.toISOString())
      .lte('start_ts', to.toISOString())
      .order('start_ts', { ascending: true })
    setEvents(evs || [])
  }

  useEffect(()=>{ loadFamily() }, [])

  const toggleAttendee = (uid:string) => {
    setAttendeeIds(prev => prev.includes(uid) ? prev.filter(x=>x!==uid) : [...prev, uid])
  }

  const toggleWeekday = (d:string) => {
    setByWeekday(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])
  }

  const checkConflicts = async(family_id:string, start_ts:string, end_ts:string, attendees:string[]) => {
    // Pull events overlapping this range and see if any share an attendee
    const { data: evs } = await supabase.from('calendar_events')
      .select('id, title, start_ts, end_ts, event_attendees(user_id)')
      .eq('family_id', family_id)
      .lte('start_ts', end_ts)
      .gte('end_ts', start_ts)
    const conflicts = (evs||[]).filter((e:any) => {
      const a = (e.event_attendees||[]).map((x:any)=>x.user_id)
      return a.some((u:string)=> attendees.includes(u))
    })
    return conflicts
  }

  const createEvent = async () => {
    if (!familyId) { alert('Join or create a family first'); return }
    if (!title.trim()) { alert('Please enter a title'); return }
    if (!date) { alert('Pick a date'); return }

    const start_ts = allDay ? new Date(date+"T00:00:00").toISOString() : new Date(date+"T"+start+":00").toISOString()
    const end_ts = allDay ? new Date(date+"T23:59:00").toISOString() : new Date(date+"T"+end+":00").toISOString()
    if (!allDay && end <= start) { alert('End time must be after start'); return }

    // Conflict check
    const conflicts = await checkConflicts(familyId, start_ts, end_ts, attendeeIds.length>0?attendeeIds:members.map(m=>m.user_id))
    if (conflicts.length > 0) {
      alert('Conflict found with existing events for selected attendees. Please adjust time or attendees.')
      return
    }

    const recurrence = recType==='NONE' ? null : { type: recType, interval: 1, byweekday: byWeekday }
    const { data: { user } } = await supabase.auth.getUser()
    const { data: ev, error } = await supabase.from('calendar_events').insert({
      family_id: familyId,
      title: title.trim(),
      description: desc || null,
      start_ts, end_ts,
      all_day: allDay,
      recurrence,
      created_by: user?.id || null
    }).select().single()
    if (error) { alert(error.message); return }

    // Attendees: default to everyone if none selected
    const attendees = attendeeIds.length>0 ? attendeeIds : members.map(m=>m.user_id)
    const { error: aerr } = await supabase.from('event_attendees').insert(attendees.map(uid => ({ event_id: ev.id, user_id: uid })))
    if (aerr) { alert(aerr.message); return }

    alert('Event created')
    setTitle(''); setDesc(''); setDate(''); setStart('09:00'); setEnd('10:00'); setAllDay(false); setRecType('NONE'); setByWeekday([]); setAttendeeIds([])
    await loadFamily()
  }

  const weekdays: string[] = ['MO','TU','WE','TH','FR','SA','SU']

  const grouped = useMemo(()=>{
    const map: Record<string, Event[]> = {}
    for (const e of events){
      const d = e.start_ts.slice(0,10)
      map[d] = map[d] || []
      map[d].push(e)
    }
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0]))
  }, [events])

  return (
    <div className="grid">
      <div className="card">
        <h2>Family Calendar</h2>
        <div className="grid grid-3">
          <input className="input" placeholder="Event title" value={title} onChange={e=>setTitle(e.target.value)} />
          <input className="input" placeholder="Description (optional)" value={desc} onChange={e=>setDesc(e.target.value)} />
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} />
          <label className="checkbox-item"><input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All-day</label>
          {!allDay && (<>
            <input className="input" type="time" value={start} onChange={e=>setStart(e.target.value)} />
            <input className="input" type="time" value={end} onChange={e=>setEnd(e.target.value)} />
          </>)}
          <select className="input" value={recType} onChange={e=>setRecType(e.target.value as any)}>
            <option value="NONE">One-time</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
          {recType==='WEEKLY' && (
            <div className="checkbox-group" style={{gridColumn:'1 / -1'}}>
              {weekdays.map(d => (
                <label key={d} className="checkbox-item"><input type="checkbox" checked={byWeekday.includes(d)} onChange={()=>toggleWeekday(d)} /><span>{d}</span></label>
              ))}
            </div>
          )}
          <div style={{gridColumn:'1 / -1'}}>
            <small className="muted">Attendees</small>
            <div className="checkbox-group">
              {members.map(m => (
                <label key={m.user_id} className="checkbox-item" style={{borderColor: colorFor(m.user_id)}}>
                  <input type="checkbox" checked={attendeeIds.includes(m.user_id)} onChange={()=>toggleAttendee(m.user_id)} />
                  <span>{m.full_name || m.email || m.user_id.slice(0,6)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <button className="button" onClick={createEvent}>Create Event</button>
        <small className="muted" style={{display:'block',marginTop:8}}>Overlapping events for selected attendees are detected before saving. Supports all-day or timed events, and one-time or recurring.</small>
      </div>

      <div className="card">
        <h3>Upcoming (next 60 days)</h3>
        {grouped.length === 0 && <p>No events yet.</p>}
        <div className="grid">
          {grouped.map(([d, es]) => (
            <div key={d} className="card">
              <b>{d}</b>
              <div className="grid">
                {es.map((e:any) => (
                  <div key={e.id} className="card">
                    <div><b>{e.title}</b> <small className="muted">({e.all_day ? 'All day' : (new Date(e.start_ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '–' + new Date(e.end_ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))})</small></div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
                      {(e.event_attendees||[]).map((a:any)=> (
                        <span key={a.user_id} className="pill" style={{borderColor: colorFor(a.user_id)}}>{members.find(m=>m.user_id===a.user_id)?.full_name || a.user_id.slice(0,6)}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
