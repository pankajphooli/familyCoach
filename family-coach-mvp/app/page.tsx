'use client'
export const dynamic = 'force-dynamic'
export const revalidate = 0
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabaseClient'
import styles from './home/home-ui.module.css'

/* ===== Types (relaxed to match your existing schema) ===== */
type Profile = {
  id?: string
  full_name?: string | null
  family_id?: string | null
  goal_weight_kg?: number | string | null
  target_weight_kg?: number | string | null
  goal_weight?: number | string | null
  target_weight?: number | string | null
  goal_date?: string | null
  target_date?: string | null
  goal_target_date?: string | null
  /* possible current weight fallbacks */
  current_weight_kg?: number | string | null
  weight_kg?: number | string | null
  last_weight_kg?: number | string | null
  current_weight?: number | string | null
}

type PlanDay = { id: string; date: string }
type WorkoutDay = { id: string; date: string }

type Meal = { id: string; plan_day_id: string; meal_type: string; recipe_name: string | null }
type WorkoutBlock = { id: string; workout_day_id: string; kind?: string | null; title?: string | null; details?: string | null }

type CalEvent = { id: string; date: string; title: string; start_time?: string | null; end_time?: string | null }

type GroceryItem = { id: string; name: string; quantity?: number | null; unit?: string | null; done?: boolean | null }

/* ===== Helpers ===== */
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayStr = ymd(new Date())

/** Label meals by position in the day (sorted by time_local) */
function labelForIndex(total: number, idx: number): string {
  // Match the generator’s intent for small counts
  if (total <= 1) return 'Dinner'
  if (total === 2) return idx === 0 ? 'Lunch' : 'Dinner'
  if (total === 3) return ['Breakfast', 'Lunch', 'Dinner'][idx]

  // 4 or more: Breakfast → Snack 1 → Lunch → Snack 2 → Dinner → Snack 3…
  const base = ['Breakfast', 'Snack 1', 'Lunch', 'Snack 2', 'Dinner']
  if (idx < base.length) return base[idx]
  return `Snack ${idx - 2}` // Snack 3, 4, ...
}

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
const [tab, setTab] = useState<'today' | 'week'>('today')
const [selDate, setSelDate] = useState<string>(
  weekDates.includes(todayStr) ? todayStr : weekDates[0]
)
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
  (a || b) ? `${(a || '').slice(0, 5)} – ${(b || '').slice(0, 5)}` : ''

function toNum(x: any): number | null {
  const n = typeof x === 'string' ? parseFloat(x) : x
  return Number.isFinite(n) ? n : null
}

function extractGoal(prof: any) {
  const goalRaw =
    prof?.goal_weight_kg ??
    prof?.target_weight_kg ??
    prof?.goal_weight ??
    prof?.target_weight ??
    null
  const goalKg = toNum(goalRaw)

  const dateRaw =
    prof?.target_date ??
    prof?.goal_date ??
    prof?.goal_target_date ??
    null

  const targetDate = dateRaw ? new Date(String(dateRaw)) : null
  return { goalKg, targetDate }
}

function extractCurrentWeight(prof: any) {
  const wRaw =
    prof?.current_weight_kg ??
    prof?.weight_kg ??
    prof?.last_weight_kg ??
    prof?.current_weight ??
    null
  return toNum(wRaw)
}

function daysLeft(to: Date | null) {
  if (!to) return null
  const t0 = new Date(new Date().toDateString()).getTime()
  const t1 = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.max(0, Math.ceil((t1 - t0) / 86400000))
}

/* De-dupe meals per day for display: show only one of each Breakfast/Lunch/Dinner (in that order) */
function dedupeMealsForDisplay(meals: Meal[]) {
  const order = ['breakfast', 'lunch', 'dinner']
  const pick: Record<string, Meal | null> = { breakfast: null, lunch: null, dinner: null }
  for (const m of meals) {
    const key = (m.meal_type || '').toLowerCase()
    if (key.includes('break') && !pick.breakfast) pick.breakfast = m
    else if (key.includes('lunch') && !pick.lunch) pick.lunch = m
    else if (key.includes('dinner') && !pick.dinner) pick.dinner = m
  }
  return order.map(k => pick[k]).filter(Boolean) as Meal[]
}

/* ===== Component ===== */
export default function HomePage() {
  const supabase = useMemo(() => createClient(), [])
  const [authChecked, setAuthChecked] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // View state
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [selDate, setSelDate] = useState<string>(todayStr)

  // Data state
  const [profile, setProfile] = useState<Profile | null>(null)
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  const [goalKg, setGoalKg] = useState<number | null>(null)
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [daysToGo, setDaysToGo] = useState<number | null>(null)
  const [kgDeltaText, setKgDeltaText] = useState<string>('—')

  const [eventsByDate, setEventsByDate] = useState<Record<string, CalEvent[]>>({})
  const [mealsByDate, setMealsByDate] = useState<Record<string, Meal[]>>({})
  const [blocksByDate, setBlocksByDate] = useState<Record<string, WorkoutBlock[]>>({})
  const [grocery, setGrocery] = useState<GroceryItem[]>([])

  const [logKg, setLogKg] = useState<string>('')

  const toast = (kind: 'success' | 'error', msg: string) => {
    if (typeof window !== 'undefined' && (window as any).toast) (window as any).toast(kind, msg)
  }

  async function detectEventsTable(): Promise<string | null> {
    const cands = ['events', 'calendar_events', 'family_events', 'household_events']
    for (const t of cands) {
      const r = await supabase.from(t).select('id').limit(1)
      if (!r.error || (r.error as any)?.code !== '42P01') return t
    }
    return null
  }

  function recomputeDelta(latest: number | null, goal: number | null) {
    if (latest != null && goal != null) {
      const diff = +(latest - goal).toFixed(1)
      setKgDeltaText(`${Math.abs(diff)} Kg ${diff > 0 ? 'above' : diff < 0 ? 'below' : 'at'} goal`)
    } else {
      setKgDeltaText('—')
    }
  }

  function applyBundleLike(d: any, uid: string) {
    // Profile & goal
    const prof = (d?.profile || d?.profiles || null) as Profile | null
    setProfile(prof)
    const { goalKg, targetDate } = extractGoal(prof || {})
    setGoalKg(goalKg)
    setTargetDate(targetDate ? ymd(targetDate) : null)
    setDaysToGo(daysLeft(targetDate))

    // Latest weight: bundle or fall back to profile current weight
    const bundleWeight = toNum(d?.weights?.kg ?? d?.weights?.[0]?.kg ?? null)
    const profWeight = extractCurrentWeight(prof || {})
    const latest = bundleWeight ?? profWeight ?? null
    setLatestWeight(latest)
    recomputeDelta(latest, goalKg)

    // Events
    const evs = Array.isArray(d?.events) ? d.events : []
    const evMap: Record<string, CalEvent[]> = {}
    weekDates.forEach(dt => (evMap[dt] = []))
    for (const row of evs) {
      const ev: CalEvent = {
        id: String(row.id),
        date: row.date,
        title: row.title || row.name || 'Event',
        start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11, 16) : null),
        end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11, 16) : null),
      }
      if (evMap[ev.date]) evMap[ev.date].push(ev)
    }
    Object.values(evMap).forEach(list => list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')))
    setEventsByDate(evMap)

    // Meals
    const pd = Array.isArray(d?.plan_days) ? d.plan_days : []
    const meals = Array.isArray(d?.meals) ? d.meals : []
    const pdBy: Record<string, string> = {}
    pd.forEach((p: any) => (pdBy[p.id] = p.date))
    const mBy: Record<string, Meal[]> = {}
    weekDates.forEach(dt => (mBy[dt] = []))
    for (const m of meals) {
      const dt = pdBy[m.plan_day_id]
      if (dt) (mBy[dt] ||= []).push(m)
    }
    // de-dupe for display
    Object.keys(mBy).forEach(dt => { mBy[dt] = dedupeMealsForDisplay(mBy[dt]) })
    setMealsByDate(mBy)

    // Workout blocks
    const wds = Array.isArray(d?.workout_days) ? d.workout_days : []
    const blks = Array.isArray(d?.workout_blocks) ? d.workout_blocks : []
    const wdBy: Record<string, string> = {}
    wds.forEach((w: any) => (wdBy[w.id] = w.date))
    const bBy: Record<string, WorkoutBlock[]> = {}
    weekDates.forEach(dt => (bBy[dt] = []))
    for (const b of blks) {
      const dt = wdBy[b.workout_day_id]
      if (dt) (bBy[dt] ||= []).push(b)
    }
    setBlocksByDate(bBy)

    // Grocery (if present in bundle)
    const g = Array.isArray(d?.grocery) ? d.grocery : []
    if (g.length) setGrocery(g as GroceryItem[])
  }

  /* Load grocery like the Grocery page: user-owned → family-owned → schema variants → fallbacks */
  async function robustGroceryLoad(uid: string, familyId?: string | null) {
    // Helper to run a query safely
    const run = async (table: string, filters: { [k: string]: any } = {}, orderByName = true) => {
      let q: any = supabase.from(table).select('id,name,quantity,unit,done')
      Object.entries(filters).forEach(([k, v]) => q = v === null ? q.is(k, null) : q.eq(k, v))
      if (orderByName) q = q.order('name')
      const r = await q
      return r.error ? [] : (r.data || [])
    }

    // 1) user-owned, done=false
    let rows = await run('grocery_items', { user_id: uid, done: false })
    if (rows.length) return setGrocery(rows)

    // 1b) user-owned, done IS NULL
    rows = await run('grocery_items', { user_id: uid, done: null })
    if (rows.length) return setGrocery(rows)

    // 1c) user-owned, no done filter
    rows = await run('grocery_items', { user_id: uid })
    if (rows.length) return setGrocery(rows)

    // 2) family-owned, done=false (if we know family_id)
    if (familyId) {
      rows = await run('grocery_items', { family_id: familyId, done: false })
      if (rows.length) return setGrocery(rows)

      // 2b) family-owned, done IS NULL
      rows = await run('grocery_items', { family_id: familyId, done: null })
      if (rows.length) return setGrocery(rows)

      // 2c) family-owned, no done filter
      rows = await run('grocery_items', { family_id: familyId })
      if (rows.length) return setGrocery(rows)
    }

    // 3) alt table name used historically
    try {
      rows = await run('shopping_items', { user_id: uid, done: false })
      if (rows.length) return setGrocery(rows as any)

      rows = await run('shopping_items', { user_id: uid, done: null })
      if (rows.length) return setGrocery(rows as any)

      rows = await run('shopping_items', { user_id: uid })
      if (rows.length) return setGrocery(rows as any)
    } catch {}

    // Default empty
    setGrocery([])
  }

  async function loadAll(uid: string) {
    setBusy(true)
    try {
      // cached bundle (if you added the RPC earlier)
      const cacheKey = `dash:${uid}:${weekDates[0]}`
      const cached = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(cacheKey) : null
      if (cached) applyBundleLike(JSON.parse(cached), uid)

      // try dashboard_bundle RPC if present
      const rpc = await supabase.rpc('dashboard_bundle', {
        p_uid: uid,
        p_start: weekDates[0],
        p_end: weekDates[6],
      })
      if (!rpc.error && rpc.data) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(rpc.data)) } catch {}
        applyBundleLike(rpc.data, uid)

        // <<< NEW: fetch family_id explicitly for grocery snapshot >>>
        const fam = await supabase.from('profiles').select('family_id').eq('id', uid).maybeSingle()
        const famId: string | null = (fam.data as any)?.family_id ?? null
        await robustGroceryLoad(uid, famId)
      } else {
        // Fallback: parallel direct reads
        const evTable = await detectEventsTable()
        const [
          profRes,
          weightRes,
          pdRes,
          wdRes,
          evRes,
        ] = await Promise.all([
          supabase.from('profiles').select(
            'id, family_id, full_name, goal_weight_kg, target_weight_kg, goal_weight, target_weight, goal_date, target_date, goal_target_date, current_weight_kg, weight_kg, last_weight_kg, current_weight'
          ).eq('id', uid).maybeSingle(),
          supabase.from('weights').select('kg').eq('user_id', uid).order('date', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('plan_days').select('id,date').eq('user_id', uid).in('date', weekDates),
          supabase.from('workout_days').select('id,date').eq('user_id', uid).in('date', weekDates),
          evTable
            ? supabase.from(evTable).select('id,title,name,date,start_time,end_time,starts_at,ends_at').gte('date', weekDates[0]).lte('date', weekDates[6])
            : Promise.resolve({ data: [] } as any),
        ])

        const prof = (profRes.data || null) as Profile | null
        setProfile(prof)
        const { goalKg, targetDate } = extractGoal(prof || {})
        setGoalKg(goalKg)
        setTargetDate(targetDate ? ymd(targetDate) : null)
        setDaysToGo(daysLeft(targetDate))

        const latest = toNum((weightRes.data as any)?.kg) ?? extractCurrentWeight(prof || {}) ?? null
        setLatestWeight(latest)
        recomputeDelta(latest, goalKg)

        const pds = (pdRes.data || []) as PlanDay[]
        const wds = (wdRes.data || []) as WorkoutDay[]
        const pdIds = pds.map(p => p.id)
        const wdIds = wds.map(w => w.id)

        const [mealsRes, blocksRes] = await Promise.all([
          pdIds.length ? supabase.from('meals').select('id,plan_day_id,meal_type,recipe_name').in('plan_day_id', pdIds) : Promise.resolve({ data: [] } as any),
          wdIds.length ? supabase.from('workout_blocks').select('id,workout_day_id,kind,title,details').in('workout_day_id', wdIds) : Promise.resolve({ data: [] } as any),
        ])

        const evMap: Record<string, CalEvent[]> = {}
        weekDates.forEach(dt => (evMap[dt] = []))
        for (const row of ((evRes as any).data || []) as any[]) {
          const ev: CalEvent = {
            id: String(row.id),
            date: row.date,
            title: row.title || row.name || 'Event',
            start_time: row.start_time || (row.starts_at ? String(row.starts_at).slice(11, 16) : null),
            end_time: row.end_time || (row.ends_at ? String(row.ends_at).slice(11, 16) : null),
          }
          if (evMap[ev.date]) evMap[ev.date].push(ev)
        }
        Object.values(evMap).forEach(list => list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')))
        setEventsByDate(evMap)

        const meals = ((mealsRes as any).data || []) as Meal[]
        const blocks = ((blocksRes as any).data || []) as WorkoutBlock[]

        const byMeals: Record<string, Meal[]> = {}
        weekDates.forEach(d => (byMeals[d] = []))
        for (const pd of pds) byMeals[pd.date] = meals.filter(m => m.plan_day_id === pd.id)
        // de-dupe view for each day
        Object.keys(byMeals).forEach(dt => { byMeals[dt] = dedupeMealsForDisplay(byMeals[dt]) })
        setMealsByDate(byMeals)

        const byBlocks: Record<string, WorkoutBlock[]> = {}
        weekDates.forEach(d => (byBlocks[d] = []))
        for (const wd of wds) byBlocks[wd.date] = blocks.filter(b => b.workout_day_id === wd.id)
        setBlocksByDate(byBlocks)

        // <<< FIX: pass the freshly fetched family_id (NOT state) >>>
        await robustGroceryLoad(uid, prof?.family_id ?? null)
      }
    } catch (e) {
      console.warn('home load error', e)
      toast('error', 'Failed to load dashboard')
    } finally {
      setBusy(false)
    }
  }

  // Auth/session boot (same pattern as your other pages)
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

  // Derived UI
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
  })()
  const name = profile?.full_name || 'there'

  const showDate = tab === 'today' ? todayStr : selDate
  const rawMeals = mealsByDate[showDate] || []
  const listMeals = dedupeMealsForDisplay(rawMeals) // extra safety
  const listEvents = (eventsByDate[showDate] || [])
  const listBlocks = (blocksByDate[showDate] || [])
  const totalMeals = listMeals.length;

  async function addWeight() {
    try {
      if (!userId) { toast('error', 'Sign in first'); return }
      const kg = parseFloat(logKg)
      if (!isFinite(kg)) { toast('error', 'Enter a valid number'); return }
      const r = await supabase.from('weights').insert({ user_id: userId, date: todayStr, kg })
      if (r.error) { toast('error', 'Could not save weight'); return }
      setLatestWeight(kg)
      if (goalKg != null) {
        const diff = +(kg - goalKg).toFixed(1)
        setKgDeltaText(`${Math.abs(diff)} Kg ${diff > 0 ? 'above' : diff < 0 ? 'below' : 'at'} goal`)
      }
      setLogKg('')
      toast('success', 'Weight logged')
    } catch {
      toast('error', 'Could not save weight')
    }
  }

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
        <div className={styles.goalRow}><div>Your Goal</div><div className={styles.goalVal}>{goalKg != null ? `${goalKg} Kg` : '—'}</div></div>
        <div className={styles.goalRow}><div>Target Date</div><div className={styles.goalVal}>{targetDate || '—'}</div></div>
        <div className={styles.goalRow}><div>Days to go</div><div className={styles.goalVal}>{daysToGo ?? '—'}</div></div>
        <div className={styles.goalDiff}>{ /* derived delta */ }</div>
        <div className={styles.goalDiff}>{kgDeltaText}</div>
      </section>

      {/* Tabs: Today / Week — font size bumped */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'today' ? styles.active : ''}`}
          onClick={() => setTab('today')}
          style={{ fontSize: '18px' }}
        >Today</button>
        <button
          className={`${styles.tab} ${tab === 'week' ? styles.active : ''}`}
          onClick={() => setTab('week')}
          style={{ fontSize: '18px' }}
        >Week</button>
      </div>

      {/* Week chips (only when Week is selected) */}
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

      {/* Calendar snapshot */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Calendar</div>
        {(busy && userId)
          ? <div className="muted">Loading…</div>
          : (listEvents.length === 0
              ? <div className="muted">No events.</div>
              : <ul className={styles.list}>
                  {listEvents.slice(0, 3).map(ev => (
                    <li key={ev.id} className={styles.row}>
                      <div>{ev.title}</div>
                      <div className={styles.time}>{timeRange(ev.start_time, ev.end_time)}</div>
                    </li>
                  ))}
                </ul>
            )
        }
      </section>

      {/* Diet */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Diet</div>
        {(busy && userId)
          ? <div className="muted">Loading…</div>
          : (listMeals.length === 0
              ? <div className="muted">No plan yet.</div>
              : <ul className={styles.list}>
                  {listMeals.map((m, i) => (
                    <li key={m.id} className={styles.row}>
                      <div>{labelForIndex(totalMeals, i)}</div>
                      <div className={styles.time}>
                        {(m as any).time_local ? ((m as any).time_local as string).slice(0, 5) : '—'}
                      </div>
                      <div className="muted" style={{ gridColumn: '1 / -1' }}>
                        {m.recipe_name || '—'}
                      </div>
                    </li>
                  ))}
                </ul>
            )
        }
      </section>

      {/* Exercise */}
      <section className="panel">
        <div className={styles.sectionTitle}>Today’s Exercise</div>
        {(busy && userId)
          ? <div className="muted">Loading…</div>
          : (listBlocks.length === 0
              ? <div className="muted">No plan yet.</div>
              : <ul className={styles.list}>
                  {listBlocks.map(b => (
                    <li key={b.id} className={styles.row}>
                      <div>{b.title || b.kind || 'Block'}</div>
                      <div className="muted" style={{ gridColumn: '1 / -1' }}>{b.details || ''}</div>
                    </li>
                  ))}
                </ul>
            )
        }
      </section>

      {/* Grocery snapshot — now correctly uses fresh family_id */}
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
