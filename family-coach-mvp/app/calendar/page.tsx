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
const addWeeks = (d: Date, n: number) => addDays(d, n*7)
const addMonthsKeepDOM = (d: Date, n: number) => {
  const nd = new Date(d)
  const day = nd.getDate()
  nd.setMonth(nd.getMonth() + n)
  // If month overflowed (e.g., adding 1 month to Jan 31 → Mar 02), clamp to last day of target month
  if (nd.getDate() < day) {
    nd.setDate(0) // move to last day of previous month
  }
  return nd
}
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

  // Recurrence
  const [repeat, setRepeat] = useState<'none'|'daily'|'weekly'|'monthly'>('none')
  const [interval, setInterval] = useState<number>(1)    // every N days/weeks/months
  const [occurrences, setOccurrences] = useState<number>(6) // total instances (including the first)  const toggleWho = (id: string) => setWho(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])

  const tryInsert = async (table: string, payloads: any[]): Promise<string | null> => {
    for(const p of payloads){
      const ins = await supabase.from(table).insert(p).select('id').maybeSingle()
      if(!ins.error && ins.data) return (ins.data as any).id as string
    }
    return null
  }

  async async function onAdd(){
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(!user){ notify('error','Sign in first'); return }
      if(!title.trim()){ notify('error','Add a title'); return }

      const base = { title: title.trim(), description: desc || null }
      const d0 = date

      // payload variants for table portability
      const mkVariants = (d:string) => ([
        { ...base, date: d, start_time: startTime, end_time: endTime, family_id: familyId || null, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime), ends_at: toIso(d, endTime), family_id: familyId || null, user_id: user.id },
        { ...base, date: d, start_time: startTime, end_time: endTime, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime), ends_at: toIso(d, endTime), user_id: user.id },
        { ...base, date: d }
      ])

      const targets = primaryEventTable ? [primaryEventTable, ...CANDIDATE_TABLES] : CANDIDATE_TABLES

      async function insertOne(d:string){
        let insertedId: string | null = null
        let usedTable: string | null = null
        for(const t of targets){
          insertedId = await tryInsert(t, mkVariants(d))
          if(insertedId){ usedTable = t; setPrimaryEventTable(t); break }
        }
        if(!insertedId || !usedTable) return { id:null, table:null }
        // persist attendees, best-effort
        if((who||[]).length){
          await supabase.from(usedTable).update({ attendees: who } as any).eq('id', insertedId)
          await supabase.from('event_attendees').insert((who||[]).map(uid=>({event_id: insertedId!, user_id: uid}))).catch(()=>{})
        }
        return { id: insertedId, table: usedTable }
      }

      // Insert the first event
      const first = await insertOne(d0)
      if(!first.id){ notify('error','Could not save event (no compatible table).'); return }

      // Expand recurrence (materialize future events) — optional
      if(repeat !== 'none' && occurrences > 1){
        const maxOcc = Math.min(occurrences, 36) // safety cap
        const startDate = new Date(d0 + 'T00:00:00')
        const mkNext = (index:number) => {
          if(repeat==='daily')   return ymd(addDays(startDate, index * Math.max(1, interval)))
          if(repeat==='weekly')  return ymd(addWeeks(startDate, index * Math.max(1, interval)))
          if(repeat==='monthly') return ymd(addMonthsKeepDOM(startDate, index * Math.max(1, interval)))
          return d0
        }
        const dates: string[] = []
        for(let i=1;i<maxOcc;i++){ dates.push(mkNext(i)) }
        for(const d of dates){
          await insertOne(d)
        }
      }

      setTitle(''); setDesc(''); setWho([])
      await loadEvents(familyId, members.map(m=>m.id), d0)
      setViewMode('date'); setSelDate(d0)
      notify('success', repeat==='none' ? 'Event added' : 'Recurring events added')
      formTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })
    }catch(e){ console.warn(e); notify('error','Something went wrong while saving.') }
  }
