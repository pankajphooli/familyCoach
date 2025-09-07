'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabaseClient'

export default function Home(){
  const supabase = createClient()
  const router = useRouter()

  // Auth + profile
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)

  // Dashboard data
  const [events, setEvents] = useState<any[]>([])
  const [meals, setMeals] = useState<any[]>([])
  const [workout, setWorkout] = useState<any[]>([])
  const [groceries, setGroceries] = useState<any[]>([])
  const [latestWeight, setLatestWeight] = useState<number | null>(null)

  // Sign-in states (must be declared at top-level, not inside conditionals)
  const [emailState, setEmailState] = useState('')
  const [pwd, setPwd] = useState('')

  // Separate state for quick weight (declared at top level)
  const [quickWeight, setQuickWeight] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted) return
      setUser(data.user || null)
      if (data.user) {
        // fetch profile
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
        if (!mounted) return
        setProfile(prof || null)
        // if missing core onboarding info, redirect
        if (!prof) { router.push('/onboarding'); return }
        // load dashboard data
        await Promise.all([
          loadEvents(prof),
          loadDiet(data.user),
          loadWorkout(data.user),
          loadGroceries(prof),
          loadLatestWeight(data.user)
        ])
      }
    })
    return () => { mounted = false }
  }, [])

  const loadEvents = async (prof:any) => {
    if(!prof?.family_id) { setEvents([]); return }
    const from = new Date(); const to = new Date(); to.setDate(to.getDate()+14)
    const { data: evs } = await supabase.from('calendar_events')
      .select('id,title,start_ts,end_ts,all_day,event_attendees(user_id)')
      .eq('family_id', prof.family_id).gte('start_ts', from.toISOString()).lte('start_ts', to.toISOString()).order('start_ts')
    setEvents(evs||[])
  }

  const loadDiet = async (u:any) => {
    const today = new Date().toISOString().slice(0,10)
    const { data: day } = await supabase.from('plan_days').select('id').eq('user_id', u.id).eq('date', today).maybeSingle()
    if(!day){ setMeals([]); return }
    const { data: ms } = await supabase.from('plan_meals').select('*').eq('plan_day_id', day.id)
    setMeals(ms||[])
  }

  const loadWorkout = async (u:any) => {
    const today = new Date().toISOString().slice(0,10)
    const { data: wday } = await supabase.from('workout_days').select('id').eq('user_id', u.id).eq('date', today).maybeSingle()
    if(!wday){ setWorkout([]); return }
    const { data: blocks } = await supabase.from('workout_blocks').select('*').eq('workout_day_id', wday.id)
    setWorkout(blocks||[])
  }

  const loadGroceries = async (prof:any) => {
    if(!prof?.family_id){ setGroceries([]); return }
    const { data: items } = await supabase.from('grocery_items').select('*').eq('family_id', prof.family_id).order('last_added_at', { ascending: false }).limit(6)
    setGroceries(items||[])
  }

  const loadLatestWeight = async (u:any) => {
    const { data: logs } = await supabase.from('logs_biometrics').select('weight_kg, date').eq('user_id', u.id).order('date', { ascending:false }).limit(1)
    if (logs && logs.length>0) setLatestWeight(Number(logs[0].weight_kg))
    else setLatestWeight(null)
  }

  const markMealEaten = async (meal:any, pct:number=100) => {
    const today = new Date().toISOString().slice(0,10)
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    await supabase.from('logs_meals').insert({ user_id: user.id, date: today, meal_type: meal.meal_type, compliance_pct: pct })
    alert('Logged!')
  }

  const addWeightReal = async () => {
    const val = Number(quickWeight)
    if (!val) return
    const today = new Date().toISOString().slice(0,10)
    const { data: { user } } = await supabase.auth.getUser()
    if(!user) return
    await supabase.from('logs_biometrics').insert({ user_id: user.id, date: today, weight_kg: val })
    setQuickWeight('')
    setLatestWeight(val)
    alert('Weight logged')
  }

  const gapText = useMemo(()=>{
    if(!profile) return ''
    const current = latestWeight ?? profile.weight_kg
    if (!current || !profile.target_weight_kg) return ''
    const diffNum = Number((Number(current) - Number(profile.target_weight_kg)).toFixed(1))
    if (diffNum === 0) return 'At goal'
    return diffNum > 0 ? `${diffNum} kg above goal` : `${Math.abs(diffNum)} kg below goal`
  }, [profile, latestWeight])

  const signUp = async() => {
    const { error } = await supabase.auth.signUp({ email: emailState, password: pwd })
    if (error) alert(error.message); else router.push('/onboarding')
  }
  const signIn = async() => {
    const { error } = await supabase.auth.signInWithPassword({ email: emailState, password: pwd })
    if (error) alert(error.message); else router.push('/onboarding')
  }

  if (!user) {
    return (
      <div className="grid">
        <div className="card">
          <h2>Welcome to HouseholdHQ</h2>
          <div className="grid grid-2">
            <input className="input" placeholder="Email" value={emailState} onChange={e=>setEmailState(e.target.value)} />
            <input className="input" placeholder="Password" type="password" value={pwd} onChange={e=>setPwd(e.target.value)} />
            <button className="button" onClick={signIn}>Sign in</button>
            <button className="button" onClick={signUp}>Sign up</button>
          </div>
        </div>
      </div>
    )
  }

  // Authenticated dashboard
  return (
    <div className="grid">
      <div className="card">
        <h2>Dashboard</h2>
        <small className="muted">At a glance: upcoming events, today’s plan, and your progress.</small>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <h3>Calendar (next 14 days)</h3>
          {events.length === 0 ? <p>No events yet. Add some in Calendar.</p> : (
            <ul>
              {events.slice(0,6).map(e => (
                <li key={e.id}>
                  <b>{new Date(e.start_ts).toLocaleDateString()}</b> — {e.title} {e.all_day ? '(All day)' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Today’s Diet</h3>
          {meals.length === 0 ? <>
            <p>No plan yet.</p>
            <button className="button" onClick={()=>router.push('/today')}>Generate</button>
          </> : (
            <div className="grid">
              {meals.map(m => (
                <div key={m.id} className="card" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div><b>{m.meal_type}</b> — {m.recipe_name} <small className="muted">{m.kcal} kcal</small></div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="button" onClick={()=>markMealEaten(m,100)}>Ate</button>
                    <button className="button" onClick={()=>markMealEaten(m,50)}>50%</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3>Today’s Workout</h3>
          {workout.length === 0 ? <>
            <p>No workout yet.</p>
            <button className="button" onClick={()=>router.push('/today')}>Generate</button>
          </> : (
            <ul>
              {workout.map(b => <li key={b.id}><b>{b.type}</b></li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <h3>Grocery</h3>
          {groceries.length === 0 ? <p>List is empty. Add items on Grocery tab or from Today’s plan.</p> : (
            <ul>{groceries.map(i => <li key={i.id}>{i.name} <small className="muted">{[i.qty,i.unit].filter(Boolean).join(' ')}</small></li>)}</ul>
          )}
          <button className="button" onClick={()=>router.push('/grocery')}>Open Grocery</button>
        </div>
        <div className="card">
          <h3>Goal tracking</h3>
          <p><b>Current:</b> {latestWeight ?? profile?.weight_kg ?? '—'} kg</p>
          <p><b>Target:</b> {profile?.target_weight_kg ?? '—'} kg</p>
          <p>{gapText}</p>
          <div className="grid grid-2">
            <input className="input" placeholder="Log weight (kg)" value={quickWeight} onChange={e=>setQuickWeight(e.target.value)} />
            <button className="button" onClick={addWeightReal}>Add</button>
          </div>
        </div>
        <div className="card">
          <h3>Tune plan</h3>
          <p>Diet & exercise are adjusted by your goals and conditions. Regenerate on the Today tab when goals change.</p>
          <button className="button" onClick={()=>router.push('/today')}>Regenerate Today</button>
        </div>
      </div>
    </div>
  )
}
