'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from './home/home-ui.module.css'
import { createClient } from '../lib/supabaseClient'

// ---- Types kept flexible to match your current schema ----
type Profile = {
  id?: string
  full_name?: string | null
  goal_weight?: number | null
  target_weight?: number | null
  goal_date?: string | null
  target_date?: string | null
}

type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }

type Meal = {
  id: string
  plan_day_id: string
  meal_type: string
  recipe_name: string | null
}

type WorkoutBlock = {
  id: string
  workout_day_id: string
  kind?: string | null
  title?: string | null
  details?: string | null
}

type CalEvent = {
  id: string
  date: string
  title: string
  start_time?: string | null
  end_time?: string | null
}

type GroceryItem = {
  id: string
  name: string
  quantity?: number | null
  unit?: string | null
  done?: boolean | null
}

// ---- Helpers ----
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayStr = ymd(new Date())

function mondayOfWeek(d: Date) {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const wd = c.getDay() || 7 // Monday=1..Sunday=7
  if (wd > 1) c.setDate(c.getDate() - (wd - 1))
  return c
}
function weekDatesFrom(d: Date) {
  const m = mondayOfWeek(d)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(m)
    dd.setDate(m.getDate() + i)
    out.push(ymd(dd))
  }
  return out
}
const weekDates = weekDatesFrom(new Date())

const MEAL_TIME: Record<string, string> = {
  breakfast: '08:00 – 09:00',
  snack: '10:30 – 11:00',
  lunch: '12:30 – 13:30',
  snack_pm: '16:00 – 16:30',
  dinner: '18:30 – 19:30',
}
const mealLabel = (t?: string) => {
  const v = (t || '').toLowerCase()
  if (v.includes('break')) return 'Breakfast'
  if (v.includes('lunch')) return 'Lunch'
  if (v.includes('dinner')) return 'Dinner'
  if (v.includes('snack')) return 'Snack'
  return 'Meal'
}
const timeRange = (a?: string | null, b?: string | null) =>
  (a || b) ? `${(a || '').slice(0, 5)} - ${(b || '').slice(0, 5)}` : ''

// ---- Component ----
export default function HomePage() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  // view state
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [selDate, setSelDate] = useState<string>(todayStr)

  // data
  const [profile, setProfile] = useState<Profile | null>(null)
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string, Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string, WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [logKg, setLogKg] = useState<string>('')

  // toast helper (reuses your global toast)
  const toast = (kind: 'success' | 'error', msg: string) => {
    if (typeof window !== 'undefined' && (window as any).toast) {
      (window as any).toast(kind, msg)
    }
  }

  // Find which events table exists in your DB (handles different setups)
  async function detectEventsTable() {
    const cands = ['events', 'calendar_events', 'family_events', 'household_events']
    for (const t of cands) {
      const r = await supabase.from(t).select('id').limit(1)
      if (!r.error || (r.error as any)?.code !== '42P01') return t
    }
    return null
  }

  // ---- Load all page data ----
  async function loadAll(uid: string) {
    setBusy(true)
    try {
      // PROFILE (both goal_* and target_* supported)
      const p = await supabase
        .from('profiles')
        .select('full_name, goal_weight, target_weight, goal_date, target_date')
        .eq('id', uid)
        .maybeSingle()
      setProfile((p.data || null) as Profile)

      // LATEST WEIGHT
      const w = await supabase
        .from('weights')
        .select('kg')
        .eq('user_id', uid)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLatestWeight((w.data as any)?.kg ?? null)

      // EVENTS (load for the whole week + today)
      const evTable = await detectEventsTable()
      const evMap: Record<string, CalEvent[]> = {}
      if (evTable) {
        const start = weekDates[0]
        const end = weekDates[6]
        const r = await supabase
          .from(evTable)
          .select('id,title,name,date,start_time,end_time,starts_at,ends_at')
          .gte('date', start)
          .lte('date', end)

        if (!r.error && r.data) {
          for (const row of r.data as any[]) {
            const d = row.date
            const ev: CalEvent = {
              id: String(row.id),
              date: d,
              title: row.title || row.name || 'Event',
              start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11, 16) : null),
              end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11, 16) : null),
            }
            ;(evMap[d] ||= []).push(ev)
          }
          Object.values(evMap).forEach(list =>
            list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
          )
        }
      }
      setEventsByDate(evMap)

      // MEALS & WORKOUTS (week)
      const pd = await supabase
        .from('plan_days')
        .select('id,date')
        .eq('user_id', uid)
        .in('date', weekDates)
      const pdIds = ((pd.data || []) as PlanDay[]).map(p => p.id)
      const meals = pdIds.length
        ? await supabase.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds)
        : { data: [] as Meal[] }
      const mByDate: Record<string, Meal[]> = {}
      weekDates.forEach(d => (mByDate[d] = []))
      for (const pday of (pd.data || []) as PlanDay[]) {
        mByDate[pday.date] = (meals.data || []).filter(m => m.plan_day_id === pday.id)
      }
      setMealsByDate(mByDate)

      const wd = await supabase
        .from('workout_days')
        .select('id,date')
        .eq('user_id', uid)
        .in('date', weekDates)
      const wdIds = ((wd.data || []) as WorkoutDay[]).map(w => w.id)
      const blocks = wdIds.length
        ? await supabase.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds)
        : { data: [] as WorkoutBlock[] }
      const bByDate: Record<string, WorkoutBlock[]> = {}
      weekDates.forEach(d => (bByDate[d] = []))
      for (const wday of (wd.data || []) as WorkoutDay[]) {
        bByDate[wday.date] = (blocks.data || []).filter(b => b.workout_day_id === wday.id)
      }
      setBlocksByDate(bByDate)

      // GROCERY (supports grocery_items or shopping_items)
      let g = await supabase
        .from('grocery_items')
        .select('id,name,quantity,unit,done')
        .eq('user_id', uid)
        .order('name')
      if (g.error) {
        g = await supabase
          .from('shopping_items')
          .select('id,name,quantity,unit,done')
          .eq('user_id', uid)
          .order('name')
      }
      setGrocery((g.data || []) as GroceryItem[])
    } catch (e) {
      console.warn('home load error', e)
      toast('error', 'Failed to load dashboard')
    } finally {
      setBusy(false)
    }
  }

  // ---- Auth/session boot (same pattern as other pages) ----
  useEffect(() => {
    let sub: { unsubscribe: () => void } | undefined
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const u = session?.user ?? (await supabase.auth.getUser()).data.user ?? null
      if (u?.id) {
        setUserId(u.id)
        await loadAll(u.id)
      }
      sub = supabase.auth.onAuthStateChange((_e, s) => {
        const id = s?.user?.id || null
        setUserId(id)
        if (id) loadAll(id)
      }).data?.subscription
      setAuthChecked(true)
    })()
    return () => { try { sub?.unsubscribe() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Derived UI values ----
  const name = profile?.full_name || 'there'
  const useGoalWeight = (profile?.goal_weight ?? profile?.target_weight) ?? null
  const useGoalDate = (profile?.goal_date ?? profile?.target_date) ?? null
  const daysToGo =
    useGoalDate ? Math.max(0, Math.ceil((+new Date((useGoalDate as string) + 'T00:00:00') - +new Date()) / 86400000)) : null
  const goalDelta =
    latestWeight != null && useGoalWeight != null
      ? Math.round((latestWeight - (useGoalWeight as number)) * 10) / 10
      : null

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
  })()

  const showDate = tab === 'today' ? todayStr : selDate
  const listEvents = eventsByDate[showDate] || []
  const listMeals = mealsByDate[showDate] || []
  const listBlocks = blocksByDate[showDate] || []

  // ---- Actions ----
  async function addWeight() {
    try {
      if (!userId) { toast('error', 'Sign in first'); return }
      const kg = parseFloat(logKg)
      if (!isFinite(kg)) { toast('error', 'Enter a valid number'); return }
      const r = await supabase.from('weights').insert({ user_id: userId, date: todayStr, kg })
      if (r.error) { toast('error', 'Could not save weight'); return }
      setLatestWeight(kg)
      setLogKg('')
      toast('success', 'Weight logged')
    } catch {
      toast('error', 'Could not save weight')
    }
  }

  // ---- Render ----
  return (
    <div className="container" style={{ display: 'grid', gap: 16, paddingBottom: 84 }}>
      <div className={styles.brand}>HouseholdHQ</div>
      <h1 className={styles.h1}>{greeting} {name}</h1>

      {!userId && authChecked && (
        <div className="panel" style={{ color: 'var(--muted)' }}>
          You’re not signed in. Sign in from the header to load your data.
        </div>
      )}

      {/* Goal card */}
      <section className={`panel ${styles.goal}`}>
        <div className={styles.goalRow}><div>Your Goal</div><div className={styles.goalVal}>{useGoalWeight != null ? `${useGoalWeight} Kg` : '—'}</div></div>
        <div className={styles.goalRow}><div>Target Date</div><div className={styles.goalVal}>{useGoalDate ? new Date((useGoalDate as string) + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div></div>
        <div className={styles.goalRow}><div>Days to go</div><div className={styles.goalVal}>{daysToGo ?? '—'}</div></div>
        <div className={styles.goalDiff}>{goalDelta != null ? `${Math.abs(goalDelta)} Kg ${goalDelta > 0 ? 'above' : 'below'} goal` : '—'}</div>
      </section>

      {/* Tabs: Today / Week (exact style: centered labels + underline on active) */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'today' ? styles.active : ''}`} onClick={() => setTab('today')}>Today</button>
        <button className={`${styles.tab} ${tab === 'week' ? styles.active : ''}`} onClick={() => setTab('week')}>Week</button>
      </div>

      {/* Week date chips (only visible in Week) */}
      {tab === 'week' && (
        <div className={styles.chips}>
          {weekDates.map(d => (
            <button
              key={d}
              className={`${styles.chip} ${selDate === d ? styles.chipOn : ''}`}
              onClick={() => setSelDate(d)}
            >
              {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      <div className={styles.subtitle}>Here’s how your {tab === 'today' ? 'today' : 'week day'} looks like</div>

      {/* Calendar */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Calendar</div>
        {busy && userId ? <div className="muted">Loading…</div> : (
          listEvents.length === 0
            ? <div className="muted">No events.</div>
            : <ul className={styles.list}>
                {listEvents.slice(0, 3).map(ev => (
                  <li key={ev.id} className={styles.row}>
                    <div>{ev.title}</div>
                    <div className={styles.time}>{timeRange(ev.start_time, ev.end_time)}</div>
                  </li>
                ))}
              </ul>
        )}
      </section>

      {/* Diet */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Diet</div>
        {busy && userId ? <div className="muted">Loading…</div> : (
          listMeals.length === 0
            ? <div className="muted">No plan yet.</div>
            : <ul className={styles.list}>
                {listMeals.map(m => (
                  <li key={m.id} className={styles.row}>
                    <div>{mealLabel(m.meal_type)}</div>
                    <div className={styles.time}>{MEAL_TIME[m.meal_type] || '—'}</div>
                    <div className="muted" style={{ gridColumn: '1 / -1' }}>{m.recipe_name || 'TBD'}</div>
                  </li>
                ))}
              </ul>
        )}
      </section>

      {/* Exercise */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Exercise</div>
        {busy && userId ? <div className="muted">Loading…</div> : (
          listBlocks.length === 0
            ? <div className="muted">No plan yet.</div>
            : <ul className={styles.list}>
                {listBlocks.map(b => (
                  <li key={b.id} className={styles.row}>
                    <div>{b.title || b.kind || 'Block'}</div>
                    <div className="muted" style={{ gridColumn: '1 / -1' }}>{b.details || ''}</div>
                  </li>
                ))}
              </ul>
        )}
      </section>

      {/* Grocery snapshot */}
      <section className="panel">
        <div className={styles.sectionTitle}>Your Grocery list</div>
        {(busy && userId)
          ? <div className="muted">Loading…</div>
          : (grocery.length === 0
              ? <div className="muted">Empty.</div>
              : <ul className={styles.list}>
                  {grocery.slice(0, 6).map(it => (
                    <li key={it.id} className={styles.row}>
                      <div>{it.name}</div>
                      <div className="muted">{it.quantity ?? ''} {it.unit ?? ''}</div>
                    </li>
                  ))}
                </ul>
            )
        }
      </section>

      {/* Log weight */}
      <section className="panel">
        <div className={styles.sectionTitle}>Log weight</div>
        <div className={styles.weightRow}>
          <input
            className={styles.weightInput}
            placeholder="Log weight (kg)"
            inputMode="decimal"
            value={logKg}
            onChange={e => setLogKg(e.target.value)}
          />
          <button className="button" onClick={addWeight}>Add</button>
        </div>
      </section>
    </div>
  )
}
