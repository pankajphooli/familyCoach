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
  attendees: string[]
  table: string
}
type ViewMode = 'date' | 'upcoming'
type Repeat = 'none' | 'weekly' | 'monthly' | 'yearly'

/* ---------- date helpers ---------- */
const ymd = (d: Date) => {
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  return `${Y}-${M}-${D}`
}
const addDays = (d: Date, n: number) => { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd }
const addMonthsKeepDOM = (d: Date, n: number) => {
  const nd = new Date(d)
  const dom = nd.getDate()
  nd.setMonth(nd.getMonth() + n)
  if (nd.getDate() < dom) nd.setDate(0) // clamp to last day
  return nd
}
const monthYear = (s: string) => new Date(s + 'T00:00:00')
  .toLocaleString(undefined, { month: 'long', year: 'numeric' })
const hhmm = (t?: string | null) => (t ? t.split(':').slice(0, 2).join(':') : '')
const rangeFmt = (a?: string | null, b?: string | null) => {
  const A = hhmm(a), B = hhmm(b)
  return A || B ? `${A} - ${B}` : ''
}
const toIso = (date: string, time?: string | null) => (time ? `${date}T${time}:00` : `${date}T00:00:00`)

/* ---------- tolerant table detection ---------- */
const CANDIDATE_TABLES = ['events', 'calendar_events', 'family_events', 'household_events']

export default function CalendarPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    return createSupabase(url, anon)
  }, [])

  // identity/family
  const [familyId, setFamilyId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])

  // chips + selection
  const todayStr = ymd(new Date())
  const [chipDates, setChipDates] = useState<string[]>([])
  const [selDate, setSelDate] = useState<string>(todayStr)
  const [viewMode, setViewMode] = useState<ViewMode>('date')

  // month label for chips (simple)
  const [monthLabel, setMonthLabel] = useState<string>(monthYear(todayStr))

  // refs
  const chipsRef = useRef<HTMLDivElement>(null)
  const formTopRef = useRef<HTMLDivElement>(null)

  // events & tables
  const [availableTables, setAvailableTables] = useState<string[]>([])
  const [primaryEventTable, setPrimaryEventTable] = useState<string>('events')
  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})

  // add form
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState<string>(todayStr)
  const [startTime, setStartTime] = useState<string>('')
  const [endTime, setEndTime] = useState<string>('')
  const [who, setWho] = useState<string[]>([])

  // recurrence
  const [repeat, setRepeat] = useState<Repeat>('none')
  const [endDate, setEndDate] = useState<string>(todayStr)

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else (kind === 'error' ? console.warn : console.log)(msg)
  }

  /* ---------- boot: family + members + tables + initial load ---------- */
  useEffect(() => {
    // build ~3 months of chips, starting today
    const span: string[] = []
    const start = new Date()
    for (let i = 0; i < 95; i++) span.push(ymd(addDays(start, i)))
    setChipDates(span)
  }, [])

  useEffect(() => {
    ;(async () => {
      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user
      if (!user) return

      // family id + self name
      const prof = await supabase.from('profiles').select('family_id, full_name').eq('id', user.id).maybeSingle()
      const fid = (prof.data?.family_id as string) || ''
      setFamilyId(fid)

      // members via family_members + self
      const names: Record<string, string> = {}
      if (fid) {
        const mems = await supabase.from('family_members').select('user_id').eq('family_id', fid)
        const uids = Array.from(new Set([...(mems.data || []).map((m: any) => m.user_id), user.id].filter(Boolean)))
        if (uids.length) {
          const prs = await supabase.from('profiles').select('id, full_name').in('id', uids)
          for (const p of (prs.data || []) as any[]) names[p.id] = p.full_name || 'Member'
        }
      }
      names[user.id] = names[user.id] || (prof.data?.full_name || 'Me')
      setMembers(Object.entries(names).map(([id, name]) => ({ id, name })))

      // detect tables
      const avail = await detectTables()
      setAvailableTables(avail)
      setPrimaryEventTable(avail[0] || 'events')

      await loadEvents(fid, Object.keys(names))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- month label update on scroll ---------- */
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const onScroll = () => {
      // find first visible chip
      const left = el.scrollLeft
      const right = left + el.clientWidth
      const btns = Array.from(el.querySelectorAll('button[data-date]')) as HTMLButtonElement[]
      for (const b of btns) {
        const x1 = b.offsetLeft
        const x2 = x1 + b.offsetWidth
        if (x2 > left && x1 < right) {
          const d = b.dataset.date!
          setMonthLabel(monthYear(d))
          break
        }
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [chipDates])

  /* ---------- helpers ---------- */
  async function detectTables(): Promise<string[]> {
    const out: string[] = []
    for (const t of CANDIDATE_TABLES) {
      const r = await supabase.from(t).select('*').limit(1)
      if (!r.error) out.push(t)
    }
    return out.length ? out : ['events']
  }

  function coerceAttendeesFromRow(r: any, fallbackUserId: string): string[] {
    if (Array.isArray(r._attendees_join)) return r._attendees_join as string[]
    const candCols = ['attendees', 'participants', 'member_ids']
    for (const c of candCols) {
      if (Array.isArray(r[c])) return (r[c] as any[]).map((x: any) => String(x))
      if (typeof r[c] === 'string') {
        const list = String(r[c]).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
        if (list.length) return list
      }
    }
    return [fallbackUserId]
  }

  async function loadEvents(fid: string, familyUserIds: string[]) {
    const start = ymd(addDays(new Date(), -120))
    const end = ymd(addDays(new Date(), 365))

    const rows: { row: any; table: string }[] = []
    const tables = availableTables.length ? availableTables : CANDIDATE_TABLES

    // by family_id
    for (const t of tables) {
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).eq('family_id', fid)
      if (!q.error && q.data) rows.push(...(q.data as any[]).map((r) => ({ row: r, table: t })))
    }
    // by user_id (any family member)
    if (familyUserIds.length) {
      for (const t of tables) {
        const q = await supabase.from(t).select('*').gte('date', start).lte('date', end).in('user_id', familyUserIds)
        if (!q.error && q.data) rows.push(...(q.data as any[]).map((r) => ({ row: r, table: t })))
      }
    }
    // plain date fallback
    for (const t of tables) {
      const q = await supabase.from(t).select('*').gte('date', start).lte('date', end)
      if (!q.error && q.data) rows.push(...(q.data as any[]).map((r) => ({ row: r, table: t })))
    }

    // join tables for attendees
    const ids = rows.map((x) => x.row.id).filter(Boolean)
    const joinMap: Record<string, string[]> = {}
    if (ids.length) {
      const ea = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', ids)
      if (!ea.error && ea.data) for (const r of ea.data as any[]) (joinMap[r.event_id] ||= []).push(r.user_id)
      const ea2 = await supabase.from('calendar_attendees').select('event_id,user_id').in('event_id', ids)
      if (!ea2.error && ea2.data) for (const r of ea2.data as any[]) (joinMap[r.event_id] ||= []).push(r.user_id)
    }

    const by: Record<string, CalEvent[]> = {}
    const fallbackUid = familyUserIds[0] || ''
    for (const { row, table } of rows) {
      const ev: CalEvent = {
        id: String(row.id),
        title: row.title || row.name || 'Event',
        description: row.description || row.details || null,
        date: row.date || (row.starts_at ? String(row.starts_at).slice(0, 10) : todayStr),
        start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11, 16) : null),
        end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11, 16) : null),
        attendees: (joinMap[row.id] || coerceAttendeesFromRow(row, fallbackUid)).filter(Boolean),
        table,
      }
      ;(by[ev.date] ||= []).push(ev)
    }
    Object.values(by).forEach((arr) =>
      arr.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '') || a.title.localeCompare(b.title))
    )
    setEventsByDate(by)
  }

  async function tryInsert(table: string, payloads: any[]) {
    // Try each payload variant until one fits the table schema
    for (const v of payloads) {
      const ins = await supabase.from(table).insert(v).select('id').maybeSingle()
      if (!ins.error && ins.data) return (ins.data as any).id as string
    }
    return null
  }

  /* ---------- recurrence expansion ---------- */
  function* expandDates(startDate: string, rpt: Repeat, untilDate: string) {
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(untilDate + 'T23:59:59')
    if (rpt === 'none') { yield startDate; return }
    let cur = new Date(start)
    while (cur <= end) {
      yield ymd(cur)
      if (rpt === 'weekly') cur = addDays(cur, 7)
      else if (rpt === 'monthly') cur = addMonthsKeepDOM(cur, 1)
      else cur = addMonthsKeepDOM(cur, 12) // yearly
    }
  }

  async function insertOne(targetTables: string[], d: string, base: any, userId: string) {
    const variants = [
      { ...base, date: d, start_time: startTime || null, end_time: endTime || null, family_id: familyId || null, user_id: userId },
      { ...base, date: d, starts_at: toIso(d, startTime || null), ends_at: toIso(d, endTime || null), family_id: familyId || null, user_id: userId },
      { ...base, date: d, start_time: startTime || null, end_time: endTime || null, user_id: userId },
      { ...base, date: d, starts_at: toIso(d, startTime || null), ends_at: toIso(d, endTime || null), user_id: userId },
      { ...base, date: d },
    ]
    for (const t of targetTables) {
      const id = await tryInsert(t, variants)
      if (id) {
        if (who.length) {
          try { await supabase.from(t).update({ attendees: who } as any).eq('id', id) } catch {}
          try { await supabase.from('event_attendees').insert(who.map((uid) => ({ event_id: id, user_id: uid }))) } catch {}
        }
        setPrimaryEventTable(t)
        return id
      }
    }
    return null
  }

  async function onAdd() {
    try {
      const { data: userWrap } = await supabase.auth.getUser()
      const user = userWrap?.user
      if (!user) { notify('error', 'Sign in first'); return }
      if (!title.trim()) { notify('error', 'Please add a title'); return }
      if (repeat !== 'none' && !endDate) { notify('error', 'Please set an end date'); return }

      const base = { title: title.trim(), description: desc || null }
      const targets = primaryEventTable ? [primaryEventTable, ...CANDIDATE_TABLES] : CANDIDATE_TABLES

      // compute all dates (inclusive)
      const dates: string[] = []
      for (const d of expandDates(date, repeat, endDate || date)) dates.push(d)

      // insert each (avoid duplicates if endDate < start)
      const unique = Array.from(new Set(dates)).sort()
      let inserted = 0
      for (const d of unique) {
        const id = await insertOne(targets, d, base, user.id)
        if (id) inserted++
      }
      if (!inserted) { notify('error', 'Could not save event'); return }

      // reset form
      setTitle(''); setDesc(''); setWho([])
      setRepeat('none'); setEndDate(date)

      await loadEvents(familyId, members.map((m) => m.id))
      setViewMode('date'); setSelDate(date)
      notify('success', repeat === 'none' ? 'Event added' : `Added ${inserted} events`)
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      console.warn(e); notify('error', 'Something went wrong while saving.')
    }
  }

  /* ---------- UI ---------- */

  const todayChip = (
    <button
      className={`chip today ${selDate === todayStr ? 'on' : ''}`}
      onClick={() => { setSelDate(todayStr); setViewMode('date'); chipsRef.current?.scrollTo({ left: 0, behavior: 'smooth' }) }}
      data-date={todayStr}
    >
      Today
    </button>
  )

  const chipButton = (d: string) => (
    <button key={d} className={`chip ${selDate === d ? 'on' : ''}`} data-date={d} onClick={() => setSelDate(d)}>
      {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' })}
    </button>
  )

  const eventsForSelected = eventsByDate[selDate] || []
  const upcomingList = Object.entries(eventsByDate)
    .filter(([d]) => d >= todayStr)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, 90)
    .flatMap(([d, arr]) => arr.map((e) => ({ d, e })))

  return (
    <div className="container cal-wrap" style={{ display: 'grid', gap: 14 }}>
      <div className="cal-head">
        <h1 className="page-title">Family Calendar</h1>
        <button className="button add-btn" onClick={() => formTopRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          Add event
        </button>
      </div>

      {/* Month label */}
      <div className="monthbar">
        <div className="monthlbls">
          <span className="monthtag primary">{monthLabel}</span>
        </div>
      </div>

      {/* Chips row (single horizontal strip with sticky Today) */}
      <div className="chips sticky-today" ref={chipsRef}>
        <button className={`chip ${viewMode === 'upcoming' ? 'on' : ''}`} onClick={() => setViewMode('upcoming')}>
          Upcoming
        </button>
        {todayChip}
        {chipDates.map(chipButton)}
      </div>

      {/* Events panel */}
      {viewMode === 'date' ? (
        <section className="panel">
          <div className="form-title" style={{ marginBottom: 6 }}>{selDate}</div>
          {eventsForSelected.length === 0 ? (
            <div className="muted">No events.</div>
          ) : (
            eventsForSelected.map((ev) => (
              <div key={`${ev.table}-${ev.id}`} className="ev-row">
                <div className="ev-title">{ev.title}</div>
                <div className="ev-time">{rangeFmt(ev.start_time, ev.end_time)}</div>
                <div className="ev-people">
                  {ev.attendees?.length
                    ? ev.attendees.map((uid) => (
                        <span key={uid}>@{members.find((m) => m.id === uid)?.name || 'Member'}</span>
                      ))
                    : <span className="muted">—</span>}
                </div>
              </div>
            ))
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="form-title">Upcoming (next 3 months)</div>
          {upcomingList.length === 0 ? (
            <div className="muted">Nothing scheduled.</div>
          ) : (
            upcomingList.map(({ d, e }) => (
              <div key={`${e.table}-${e.id}`} className="ev-row">
                <div className="ev-title">{e.title}</div>
                <div className="ev-time">
                  {d} · {rangeFmt(e.start_time, e.end_time)}
                </div>
                <div className="ev-people">
                  {e.attendees?.length
                    ? e.attendees.map((uid) => (
                        <span key={uid}>@{members.find((m) => m.id === uid)?.name || 'Member'}</span>
                      ))
                    : <span className="muted">—</span>}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* Add Event (with Recurrence) */}
      <section className="panel" ref={formTopRef} id="add-form">
        <div className="form-title">Add Event</div>
        <input className="line-input" placeholder="Event Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="line-input" placeholder="Event Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="grid-3">
          <div>
            <div className="lbl">Start Date</div>
            <input className="pill-input" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value) }} />
          </div>
          <div>
            <div className="lbl">Start Time</div>
            <input className="pill-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <div className="lbl">End Time</div>
            <input className="pill-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="lbl">Repeats</div>
          <select className="pill-input" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            <option value="none">Does not repeat</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        {repeat !== 'none' && (
          <div style={{ marginTop: 10 }}>
            <div className="lbl">End Date</div>
            <input
              className="pill-input"
              type="date"
              value={endDate}
              min={date}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        )}

        {/* Attendees */}
        <div className="lbl" style={{ marginTop: 12 }}>Attendees</div>
        <div className="chips wrap">
          {members.map((m) => {
            const on = who.includes(m.id)
            return (
              <button
                key={m.id}
                className={`chip ${on ? 'on' : ''}`}
                onClick={() =>
                  setWho((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                }
              >
                {m.name}
              </button>
            )
          })}
        </div>

        <div className="actions">
          <button className="button" onClick={onAdd}>Save Event</button>
        </div>
      </section>
    </div>
  )
}
