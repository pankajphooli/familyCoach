'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabaseClient' // ← change to '../lib/supabaseClient' if your file name uses capital C

type Step = 1 | 2 | 3
type Kid = { name: string; dob: string }

function ymdLocal(d: Date){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

export default function OnboardingPage(){
  const supabase = useMemo(()=>createClient(), [])
  const router = useRouter()

  // gating
  const [checking, setChecking] = useState(true)

  // steps & busy
  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string|null>(null)

  // profile fields
  const [goalWeight, setGoalWeight] = useState<string>('')           // kg
  const [goalDate, setGoalDate] = useState<string>(ymdLocal(new Date()))
  const [dietPattern, setDietPattern] = useState<string>('')         // 'veg' | 'non_veg' | 'vegan' | etc
  const [meatPolicy, setMeatPolicy] = useState<string>('')           // 'non_veg_chicken_only' etc
  const [allergies, setAllergies] = useState<string>('')             // CSV → string[]
  const [dislikes, setDislikes] = useState<string>('')               // CSV
  const [cuisines, setCuisines] = useState<string>('')               // CSV
  const [injuries, setInjuries] = useState<string>('')               // CSV
  const [conditions, setConditions] = useState<string>('')           // CSV
  const [equipment, setEquipment] = useState<string>('')             // CSV

  // family
  const [existingFamilyId, setExistingFamilyId] = useState<string| null>(null)
  const [familyName, setFamilyName] = useState<string>('')
  const [inviteCode, setInviteCode] = useState<string>('')
  const [kids, setKids] = useState<Kid[]>([])
  const [kidName, setKidName] = useState(''); const [kidDob, setKidDob] = useState('')

  // UX helpers
  function toast(kind:'success'|'error'|'info', msg:string){
    (window as any)?.toast ? (window as any).toast(kind, msg) : (kind==='error' ? console.warn(msg) : console.log(msg))
  }

  // preload profile to keep it smooth & allow resume
  useEffect(()=>{(async()=>{
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ setChecking(false); return } // middleware should redirect; we still guard
    // if user already onboarded enough (has family OR has diet prefs/goal), we let them continue using the app
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, family_id, goal_weight, goal_target_date, dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs, injuries, health_conditions, equipment')
      .eq('id', user.id).maybeSingle()

    if(prof){
      setExistingFamilyId(prof.family_id ?? null)
      setGoalWeight(prof.goal_weight?.toString?.() || '')
      setGoalDate(prof.goal_target_date || ymdLocal(new Date()))
      setDietPattern(prof.dietary_pattern || '')
      setMeatPolicy(prof.meat_policy || '')
      setAllergies(Array.isArray(prof.allergies)? prof.allergies.join(', ') : (prof.allergies||''))
      setDislikes(Array.isArray(prof.dislikes)? prof.dislikes.join(', ') : (prof.dislikes||''))
      setCuisines(Array.isArray(prof.cuisine_prefs)? prof.cuisine_prefs.join(', ') : (prof.cuisine_prefs||''))
      setInjuries(Array.isArray(prof.injuries)? prof.injuries.join(', ') : (prof.injuries||''))
      setConditions(Array.isArray(prof.health_conditions)? prof.health_conditions.join(', ') : (prof.health_conditions||''))
      setEquipment(Array.isArray(prof.equipment)? prof.equipment.join(', ') : (prof.equipment||''))
    }
    setChecking(false)
  })()},[supabase])

  function parseCSV(s:string){ return s.split(',').map(x=>x.trim()).filter(Boolean) }

  async function saveStep1(){
    setBusy(true); setErr(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Please sign in again')

      const payload:any = {
        id: user.id,
        goal_weight: goalWeight? Number(goalWeight) : null,
        goal_target_date: goalDate || null,
      }
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict:'id' })
      if(error) throw error
      toast('success','Saved goals')
      setStep(2)
    }catch(e:any){ setErr(e.message || 'Could not save'); toast('error','Could not save') }
    finally{ setBusy(false) }
  }

  async function saveStep2(){
    setBusy(true); setErr(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Please sign in again')

      const payload:any = {
        id: user.id,
        dietary_pattern: dietPattern || null,
        meat_policy: meatPolicy || null,
        allergies: parseCSV(allergies),
        dislikes: parseCSV(dislikes),
        cuisine_prefs: parseCSV(cuisines),
        injuries: parseCSV(injuries),
        health_conditions: parseCSV(conditions),
        equipment: parseCSV(equipment),
      }
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict:'id' })
      if(error) throw error
      toast('success','Preferences saved')
      setStep(3)
    }catch(e:any){ setErr(e.message || 'Could not save'); toast('error','Could not save') }
    finally{ setBusy(false) }
  }

  async function createFamily(){
    setBusy(true); setErr(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Please sign in again')
      if(!familyName.trim()) throw new Error('Enter a family name')

      // make invite code (5–6 chars)
      const code = Math.random().toString(36).slice(2, 8)
      const { data: fam, error } = await supabase.from('families').insert({ name: familyName.trim(), invite_code: code }).select('id').maybeSingle()
      if(error) throw error
      if(!fam?.id) throw new Error('Could not create family')

      // link
      await supabase.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
      await supabase.from('family_members').insert({ family_id: fam.id, user_id: user.id, role:'owner', can_manage_members: true })

      setExistingFamilyId(fam.id)
      toast('success','Family created')
    }catch(e:any){ setErr(e.message || 'Could not create family'); toast('error','Could not create family') }
    finally{ setBusy(false) }
  }

  async function joinFamily(){
    setBusy(true); setErr(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Please sign in again')
      if(!inviteCode.trim()) throw new Error('Enter the invite code')

      const { data: fam, error } = await supabase.from('families').select('id').eq('invite_code', inviteCode.trim()).maybeSingle()
      if(error) throw error
      if(!fam?.id) throw new Error('Invalid code')

      await supabase.from('profiles').update({ family_id: fam.id }).eq('id', user.id)
      await supabase.from('family_members').insert({ family_id: fam.id, user_id: user.id, role:'member', can_manage_members:false })

      setExistingFamilyId(fam.id)
      toast('success','Joined family')
    }catch(e:any){ setErr(e.message || 'Could not join family'); toast('error','Could not join family') }
    finally{ setBusy(false) }
  }

  function addKidLocal(){
    if(!kidName.trim() || !kidDob) return
    setKids(prev => [...prev, { name:kidName.trim(), dob:kidDob }])
    setKidName(''); setKidDob('')
  }

  async function saveKids(){
    if(!existingFamilyId || !kids.length) return
    const rows = kids.map(k => ({ family_id: existingFamilyId, name: k.name, dob: k.dob }))
    await supabase.from('dependents').insert(rows)
  }

  async function finish(){
    setBusy(true); setErr(null)
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Please sign in again')

      await saveKids()

      toast('success','Onboarding complete!')
      router.replace('/')       // go to dashboard
      router.refresh()
    }catch(e:any){ setErr(e.message || 'Something went wrong'); toast('error','Something went wrong') }
    finally{ setBusy(false) }
  }

  if(checking){
    return <div className="container"><div className="muted">Loading…</div></div>
  }

  return (
    <div className="container" style={{display:'grid', gap:14, paddingBottom:84}}>
      {/* Heading / brand */}
      <div style={{ textAlign:'center', fontWeight:800, fontSize:24, marginTop:6 }}>HouseholdHQ</div>
      <h1 className="text-2xl font-semibold" style={{marginTop:2}}>Let’s get you set up</h1>

      {/* Progress dots */}
      <div style={{display:'flex', gap:6}}>
        {[1,2,3].map(n=>(
          <div key={n} style={{
            width:10, height:10, borderRadius:999,
            background: step===n ? '#111' : 'rgba(0,0,0,.18)'
          }}/>
        ))}
      </div>

      {/* STEP 1 */}
      {step===1 && (
        <section className="card" style={{display:'grid', gap:12}}>
          <div style={{fontWeight:800}}>Goals</div>

          <label className="lbl">Your goal weight (kg)</label>
          <input className="pill-input" inputMode="decimal" placeholder="e.g. 78"
                 value={goalWeight} onChange={e=>setGoalWeight(e.target.value)} />

          <label className="lbl">Target date</label>
          <input className="pill-input" type="date" value={goalDate} onChange={e=>setGoalDate(e.target.value)} />

          {err && <div style={{color:'#b00020'}}>{err}</div>}

          <div className="actions" style={{gap:8}}>
            <button className="button-outline" onClick={()=>router.replace('/')}>Skip</button>
            <button className="button" disabled={busy} onClick={saveStep1}>{busy?'Saving…':'Next'}</button>
          </div>
        </section>
      )}

      {/* STEP 2 */}
      {step===2 && (
        <section className="card" style={{display:'grid', gap:12}}>
          <div style={{fontWeight:800}}>Diet & exercise preferences</div>

          <label className="lbl">Dietary pattern</label>
          <select className="pill-input" value={dietPattern} onChange={e=>setDietPattern(e.target.value)}>
            <option value="">Select…</option>
            <option value="veg">Vegetarian</option>
            <option value="non_veg">Non-vegetarian</option>
            <option value="vegan">Vegan</option>
            <option value="jain">Jain</option>
            <option value="omnivore">Omnivore</option>
          </select>

          <label className="lbl">Meat policy (if non-veg)</label>
          <select className="pill-input" value={meatPolicy} onChange={e=>setMeatPolicy(e.target.value)}>
            <option value="">Select…</option>
            <option value="non_veg_chicken_only">Chicken only</option>
            <option value="non_veg_any">Any non-veg</option>
          </select>

          <label className="lbl">Allergies (comma-separated)</label>
          <input className="pill-input" placeholder="peanut, gluten" value={allergies} onChange={e=>setAllergies(e.target.value)} />

          <label className="lbl">Dislikes (comma-separated)</label>
          <input className="pill-input" placeholder="okra, beetroot" value={dislikes} onChange={e=>setDislikes(e.target.value)} />

          <label className="lbl">Preferred cuisines (comma-separated)</label>
          <input className="pill-input" placeholder="indian, italian" value={cuisines} onChange={e=>setCuisines(e.target.value)} />

          <label className="lbl">Injuries (comma-separated)</label>
          <input className="pill-input" placeholder="knee, shoulder" value={injuries} onChange={e=>setInjuries(e.target.value)} />

          <label className="lbl">Health conditions (comma-separated)</label>
          <input className="pill-input" placeholder="hypertension" value={conditions} onChange={e=>setConditions(e.target.value)} />

          <label className="lbl">Equipment available (comma-separated)</label>
          <input className="pill-input" placeholder="dumbbells, resistance band" value={equipment} onChange={e=>setEquipment(e.target.value)} />

          {err && <div style={{color:'#b00020'}}>{err}</div>}

          <div className="actions" style={{gap:8}}>
            <button className="button-outline" onClick={()=>setStep(1)}>Back</button>
            <button className="button" disabled={busy} onClick={saveStep2}>{busy?'Saving…':'Next'}</button>
          </div>
        </section>
      )}

      {/* STEP 3 */}
      {step===3 && (
        <section className="card" style={{display:'grid', gap:14}}>
          <div style={{fontWeight:800}}>Family</div>

          {!existingFamilyId && (
            <>
              <div className="muted">Create a family or join one with an invite code.</div>

              <div style={{display:'grid', gap:8}}>
                <label className="lbl">Create a family</label>
                <div style={{display:'flex', gap:8}}>
                  <input className="pill-input" placeholder="Family name" value={familyName} onChange={e=>setFamilyName(e.target.value)} />
                  <button className="button" onClick={createFamily} disabled={busy}>Create</button>
                </div>
              </div>

              <div style={{display:'grid', gap:8}}>
                <label className="lbl">Join with invite code</label>
                <div style={{display:'flex', gap:8}}>
                  <input className="pill-input" placeholder="e.g. pqg5a5" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} />
                  <button className="button-outline" onClick={joinFamily} disabled={busy}>Join</button>
                </div>
              </div>
            </>
          )}

          {existingFamilyId && (
            <div className="card" style={{display:'grid', gap:10}}>
              <div className="muted">Family linked ✓ — add kids (optional)</div>

              <div style={{display:'flex', gap:8}}>
                <input className="pill-input" placeholder="Child name" value={kidName} onChange={e=>setKidName(e.target.value)} />
                <input className="pill-input" type="date" value={kidDob} onChange={e=>setKidDob(e.target.value)} />
                <button className="button-outline" onClick={addKidLocal}>Add</button>
              </div>

              {kids.length>0 && (
                <ul className="grid" style={{gap:6}}>
                  {kids.map((k,i)=>(<li key={i}>• {k.name} — <span className="muted">{k.dob}</span></li>))}
                </ul>
              )}
            </div>
          )}

          {err && <div style={{color:'#b00020'}}>{err}</div>}

          <div className="actions" style={{gap:8}}>
            <button className="button-outline" onClick={()=>setStep(2)}>Back</button>
            <button className="button" disabled={busy} onClick={finish}>{busy?'Saving…':'Finish'}</button>
          </div>
        </section>
      )}
    </div>
  )
}
