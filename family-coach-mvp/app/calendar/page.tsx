'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../lib/supabaseClient'

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

/* ---------------- Date helpers ---------------- */
const ymd = (d: Date) => {
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  return `${Y}-${M}-${D}`
}
const addDays = (d: Date, n: number) => {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + n)
  return nd
}
const addWeeks = (d: Date, n: number) => addDays(d, n * 7)
const addMonthsKeepDOM = (d: Date, n: number) => {
  const nd = new Date(d)
  const dom = nd.getDate()
  nd.setMonth(nd.getMonth() + n)
  if (nd.getDate() < dom) nd.setDate(0)
  return nd
}
const daysSpan = (start: Date, n: number) => Array.from({ length: n }, (_, i) => ymd(addDays(start, i)))
const monthYear = (s: string) => {
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}
const isMonthStart = (s: string) => s.slice(-2) === '01'
const hhmm = (t?: string | null) => (t ? t.split(':').slice(0, 2).join(':') : '')
const rangeFmt = (a?: string | null, b?: string | null) => {
  const A = hhmm(a), B = hhmm(b)
  return A || B ? `${A} - ${B}` : ''
}
const toIso = (date: string, time?: string | null) => (time ? `${date}T${time}:00` : `${date}T00:00:00`)

/* ---------------- Candidate tables (tolerant across schemas) ---------------- */
const CANDIDATE_TABLES = ['events', 'calendar_events', 'family_events', 'household_events']

export default function CalendarPage() {
  const supabase = useMemo(() => createClient(), [])

  // identity/family
  const [familyId, setFamilyId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])

  // chips + selection
  const todayStr = ymd(new Date())
  const [chipDates] = useState<string[]>(daysSpan(addDays(new Date(), 1), 180)) // ~6 months ahead
  const [selDate, setSelDate] = useState<string>(todayStr)
  const [viewMode, setViewMode] = useState<ViewMode>('date')

  // month labels for chips
  const [primaryMonth, setPrimaryMonth] = useState<string>(monthYear(todayStr))
  const [secondaryMonth, setSecondaryMonth] = useState<{ label: string; x: number } | null>(null)

  // refs
  const chipsRef = useRef<HTMLDivElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
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
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const [interval, setInterval] = useState<number>(1)
  const [occurrences, setOccurrences] = useState<number>(6)

  function notify(kind: 'success' | 'error', msg: string) {
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
    else (kind === 'error' ? console.warn : console.log)(msg)
  }

  /* ---------------- boot: family + members + tables + initial load ---------------- */
  useEffect(() => {
    ;(async () => {
      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user
      if (!user) return

      // family id + self name
      const prof = await supabase.from('profiles').select('family_id, full_name').eq('id', user.id).maybeSingle()
      const fid = (prof.data?.family_id as string) || ''
      setFamilyId(fid)

      // members (profiles) via family_members + self
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
      requestAnimationFrame(updateMonthLabels)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- month labels behavior ---------------- */
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const onScroll = () => updateMonthLabels()
    el.addEventListener('scroll', onScroll, { passive: true })
    updateMonthLabels()
    return () => el.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipDates])

  function updateMonthLabels() {
    const el = chipsRef.current
    if (!el) return
    const left = el.scrollLeft
    const right = left + el.clientWidth
    const btns = Array.from(el.querySelectorAll('button[data-date]')) as HTMLButtonElement[]
    if (!btns.length) return

    // primary = month of first visible chip
    let firstVisibleDate = btns[0].dataset.date!
    for (const b of btns) {
      const bx1 = b.offsetLeft, bx2 = bx1 + b.offsetWidth
      const visible = bx2 > left && bx1 < right
      if (visible) { firstVisibleDate = b.dataset.date!; break }
    }
    setPrimaryMonth(monthYear(firstVisibleDate))

    // secondary = first month-start chip visible/right of viewport; clamp at left
    let monthStartBtn: HTMLButtonElement | null = null
    for (const b of btns) {
      const d = b.dataset.date!
      if (!isMonthStart(d)) continue
      const bx1 = b.offsetLeft, bx2 = bx1 + b.offsetWidth
      const overlaps = bx2 > left && bx1 < right
      if (overlaps || bx1 >= left) { monthStartBtn = b; break }
    }
    if (monthStartBtn) {
      const x = Math.max(0, monthStartBtn.offsetLeft - left)
      setSecondaryMonth({ label: monthYear(monthStartBtn.dataset.date!), x })
    } else {
      setSecondaryMonth(null)
    }
  }

  /* ---------------- helpers ---------------- */
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
    for (const { row, table } of rows) {
      const ev: CalEvent = {
        id: String(row.id),
        title: row.title || row.name || 'Event',
        description: row.description || row.details || null,
        date: row.date || (row.starts_at ? String(row.starts_at).slice(0, 10) : todayStr),
        start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11, 16) : null),
        end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11, 16) : null),
        attendees: (joinMap[row.id] || coerceAttendeesFromRow(row, familyUserIds[0] || '')).filter(Boolean),
        table,
      }
      ;(by[ev.date] ||= []).push(ev)
    }
    Object.values(by).forEach((arr) =>
      arr.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '') || a.title.localeCompare(b.title))
    )
    setEventsByDate(by)
  }

  async function tryInsert(table: string, variants: any[]) {
    for (const v of variants) {
      const ins = await supabase.from(table).insert(v).select('id').maybeSingle()
      if (!ins.error && ins.data) return (ins.data as any).id as string
    }
    return null
  }

  async function onAdd() {
    try {
      const { data: userWrap } = await supabase.auth.getUser()
      const user = userWrap?.user
      if (!user) { notify('error', 'Sign in first'); return }
      if (!title.trim()) { notify('error', 'Add a title'); return }

      const base = { title: title.trim(), description: desc || null }
      const d0 = date

      const targets = primaryEventTable ? [primaryEventTable, ...CANDIDATE_TABLES] : CANDIDATE_TABLES
      const mkVariants = (d: string) => [
        { ...base, date: d, start_time: startTime || null, end_time: endTime || null, family_id: familyId || null, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime || null), ends_at: toIso(d, endTime || null), family_id: familyId || null, user_id: user.id },
        { ...base, date: d, start_time: startTime || null, end_time: endTime || null, user_id: user.id },
        { ...base, date: d, starts_at: toIso(d, startTime || null), ends_at: toIso(d, endTime || null), user_id: user.id },
        { ...base, date: d },
      ]

      async function insertOne(d: string) {
        let insertedId: string | null = null
        let usedTable: string | null = null
        for (const t of targets) {
          const id = await tryInsert(t, mkVariants(d))
          if (id) { insertedId = id; usedTable = t; setPrimaryEventTable(t); break }
        }
        if (!insertedId || !usedTable) return { id: null, table: null }
        if (who.length) {
          await supabase.from(usedTable).update({ attendees: who } as any).eq('id', insertedId)
          try {
            await supabase.from('event_attendees').insert(who.map((uid) => ({ event_id: insertedId!, user_id: uid })))
          } catch (_) {}
        }
        return { id: insertedId, table: usedTable }
      }

      // first event
      const first = await insertOne(d0)
      if (!first.id) { notify('error', 'Could not save event'); return }

      // recurrence expansion
      if (repeat !== 'none' && occurrences > 1) {
        const maxOcc = Math.min(occurrences, 36)
        const baseDate = new Date(d0 + 'T00:00:00')
        const mkNext = (i: number) => {
          if (repeat === 'daily') return ymd(addDays(baseDate, i * Math.max(1, interval)))
          if (repeat === 'weekly') return ymd(addWeeks(baseDate, i * Math.max(1, interval)))
          if (repeat === 'monthly') return ymd(addMonthsKeepDOM(baseDate, i * Math.max(1, interval)))
          return d0
        }
        for (let i = 1; i < maxOcc; i++) await insertOne(mkNext(i))
      }

      setTitle(''); setDesc(''); setWho([])
      setRepeat('none'); setInterval(1); setOccurrences(6)

      await loadEvents(familyId, members.map((m) => m.id))
      setViewMode('date'); setSelDate(d0)
      notify('success', repeat === 'none' ? 'Event added' : 'Recurring events added')
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      console.warn(e); notify('error', 'Something went wrong while saving.')
    }
  }

  /* ---------------- UI: month labels + chips ---------------- */
  const todayChip = (
    <button
      className={`chip today ${selDate === todayStr ? 'on' : ''}`}
      onClick={() => {
        setSelDate(todayStr)
        setViewMode('date')
        requestAnimationFrame(() => chipsRef.current?.scrollTo({ left: 0, behavior: 'smooth' }))
      }}
      data-date={todayStr}
    >
      Today
    </button>
  )

  const chipButton = (d: string) => (
    <button key={d} className={`chip ${selDate === d ? 'on' : ''}`} data-date={d} onClick={() => setSelDate(d)}>
      {d.slice(-2)}
    </button>
  )

  // Events for selected date & upcoming list (next ~3 months)
  const eventsForSelected = eventsByDate[selDate] || []
  const upcomingList = Object.entries(eventsByDate)
    .filter(([d]) => d >= todayStr)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, 90)
    .flatMap(([d, arr]) => arr.map((e) => ({ d, e })))

  return (
    <div className="container cal-wrap" style={{ display: 'grid', gap: 14 }}>
      <div className="cal-head">
        <h1 className="page-title">Calendar</h1>
        <button className="button add-btn" onClick={() => formTopRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          Add event
        </button>
      </div>

      {/* Month labels */}
      <div className="monthbar">
        <div className="monthlbls">
          <span className="monthtag primary">{primaryMonth}</span>
          {secondaryMonth && (
            <span className="monthtag secondary" style={{ left: secondaryMonth.x }}>
              {secondaryMonth.label}
            </span>
          )}
        </div>
      </div>

      {/* Chips row — single horizontal strip */}
      <div className="chips sticky-today" ref={chipsRef}>
        {/* Calendar jump */}
        <button
          className="chip"
          onClick={() => {
            dateInputRef.current?.showPicker?.()
            dateInputRef.current?.focus()
          }}
        >
          📅 Calendar
        </button>
        <input
          ref={dateInputRef}
          type="date"
          className="visually-hidden"
          onChange={(e) => {
            const v = e.target.value
            if (v) {
              setSelDate(v)
              setViewMode('date')
              const el = chipsRef.current
              const btn = el?.querySelector(`button[data-date="${v}"]`) as HTMLButtonElement | null
              if (btn && el) el.scrollTo({ left: Math.max(0, btn.offsetLeft - 20), behavior: 'smooth' })
            }
          }}
        />

        {/* Upcoming */}
        <button className={`chip ${viewMode === 'upcoming' ? 'on' : ''}`} onClick={() => setViewMode('upcoming')}>
          Upcoming
        </button>

        {/* Today (sticky at left) */}
        {todayChip}

        {/* Future dates */}
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
                  {ev.attendees.length
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
                  {e.attendees.length
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

      {/* Add event */}
      <section className="panel" ref={formTopRef} id="add-form">
        <div className="form-title">Add Event</div>
        <input className="line-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="line-input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="grid-3">
          <div>
            <div className="lbl">Date</div>
            <input className="pill-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Start</div>
            <input className="pill-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <div className="lbl">End</div>
            <input className="pill-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        {/* Attendees */}
        <div className="lbl" style={{ marginTop: 10 }}>Attendees</div>
        <div className="chips wrap">
          {members.map((m) => {
            const on = who.includes(m.id)
            return (
              <button
                key={m.id}
                className={`chip ${on ? 'on' : ''}`}
                onClick={() => setWho((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
              >
                {m.name}
              </button>
            )
          })}
        </div>

        {/* Recurrence */}
        <div className="grid-3" style={{ marginTop: 12 }}>
          <div>
            <div className="lbl">Repeat</div>
            <select className="pill-input" value={repeat} onChange={(e) => setRepeat(e.target.value as any)}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div className="lbl">Every</div>
            <input className="pill-input" type="number" min={1} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value || 1)))} />
          </div>
          <div>
            <div className="lbl">Occurrences</div>
            <input className="pill-input" type="number" min={1} max={36} value={occurrences} onChange={(e) => setOccurrences(Math.max(1, Math.min(36, Number(e.target.value || 1))))} />
          </div>
        </div>

        <div className="actions">
          <button className="button" onClick={onAdd}>Save Event</button>
        </div>
      </section>
    </div>
  )
}
