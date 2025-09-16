import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'

// Run on the server (Node runtime)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ======================= Types ======================= */

type Profile = {
  id: string
  dietary_pattern?: string|null           // "veg", "non_veg_chicken_only", etc.
  meat_policy?: string|null
  allergies?: string[]|null
  dislikes?: string[]|null
  cuisine_prefs?: string[]|null
  injuries?: string[]|null
  health_conditions?: string[]|null
  equipment?: string[]|null

  // Feeding schedule knobs
  meals_per_day?: number|null             // 1..6 (default 3)
  eating_window_start?: string|null       // "HH:MM" (local/London)
  eating_window_end?: string|null         // "HH:MM"
  fasting_hours?: number|null             // e.g., 16 (=> default window 12:00–20:00)
}

type Recipe = {
  name: string
  dietary_pattern?: string|null
  allergens?: string[]|null
  tags?: any                              // text | text[] | jsonb[]
  ingredients?: string[]|null
  cuisine?: string|null
}

type Exercise = {
  name: string
  tags?: any                              // text | text[] | jsonb[]
  equipment?: string[]|null
  contraindications?: string[]|null
  description?: string|null
}

/* ======================= Time helpers (Europe/London) ======================= */

function ymdFromParts(y:number,m:number,d:number){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` }

function nowInLondon(): Date {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p=>[p.type, p.value]))
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day)
  const hh = Number(parts.hour), mm = Number(parts.minute), ss = Number(parts.second)
  return new Date(Date.UTC(y, m-1, d, hh, mm, ss))
}
function ymdLocal(d:Date){ return ymdFromParts(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate()) }

function addDays(d:Date, n:number){ const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x }
function rangeDays(start:Date, count:number){ return Array.from({length:count},(_,i)=> addDays(start,i)) }

function normalize(s?:string|null){ return (s||'').trim().toLowerCase() }
function pad2(n:number){ return String(n).padStart(2, '0') }
function toHM(s?:string|null): [number, number] | null {
  if(!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if(!m) return null
  const hh = Math.max(0, Math.min(23, Number(m[1])))
  const mm = Math.max(0, Math.min(59, Number(m[2])))
  return [hh, mm]
}
function hmToStr(h:number,m:number){ return `${pad2(h)}:${pad2(m)}:00` }

/* ======================= Randomness & tags ======================= */

function hashString(s:string){
  let h = 2166136261 >>> 0
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(seed:number){
  return function(){ let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function seededShuffle<T>(arr:T[], rnd:()=>number){
  const a = arr.slice()
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [a[i],a[j]] = [a[j],a[i]] }
  return a
}

function normalizeTags(tags:any): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags.map((t:any)=> normalize(typeof t === 'string' ? t : String(t)))
  return String(tags).split(/[,;|]/g).map(x=>normalize(x)).filter(Boolean)
}

/* ======================= Constraints & intelligence ======================= */

function isRecipeAllowed(rec: Recipe, prof: Profile){
  const patt = normalize(prof.dietary_pattern||prof.meat_policy)
  const rp   = normalize(rec.dietary_pattern||'')
  const nm   = normalize(rec.name||'')
  const allergies = (prof.allergies||[]).map(normalize)
  const dislikes  = (prof.dislikes ||[]).map(normalize)
  const recAllergens: string[] = ((rec as any).allergens || []).map((x:any)=>normalize(String(x)))

  if(patt){
    if(patt.includes('veg') && !patt.includes('non')) {
      if(rp && !(rp.includes('veg') || rp.includes('vegan') || rp.includes('vegetarian'))) {
        const banned = ['chicken','beef','pork','mutton','lamb','fish','tuna','salmon','prawn','shrimp','shellfish','bacon']
        if(banned.some(b => nm.includes(b))) return false
      }
    } else if(patt.includes('chicken') && patt.includes('non')) {
      const banned = ['beef','pork','mutton','lamb','fish','tuna','salmon','prawn','shrimp','shellfish','bacon']
      if(banned.some(b => nm.includes(b))) return false
    }
  }
  if(allergies.length && recAllergens.some(a => allergies.includes(a))) return false
  if(dislikes.length  && dislikes.some(d => d && nm.includes(d))) return false
  return true
}

function isExerciseAllowed(ex: Exercise, prof:Profile){
  const have = new Set((prof.equipment||[]).map(normalize))
  const need: string[] = ((ex.equipment||[]) as any[]).map(x=>normalize(String(x)))
  const contra: string[] = ((ex.contraindications||[]) as any[]).map(x=>normalize(String(x)))
  const flags = new Set([...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalize))
  const okEquip = need.length===0 || need.includes('none') || need.every(n=>have.has(n))
  if(!okEquip) return false
  if(contra.length && [...flags].some(f => contra.includes(f))) return false
  return true
}

function scoreRecipeForProfile(rec:Recipe, prof:Profile, hintTags:string[]){
  // Simple scoring that prefers hint tag match + cuisine_prefs + declared dietary pattern
  let score = 0
  const tags = normalizeTags((rec as any).tags)
  const name = normalize(rec.name)
  const hints = new Set(hintTags.map(normalize))
  for(const h of hints){ if(tags.includes(h) || name.includes(h)) score += 3 }

  const cz = normalize(rec.cuisine||'')
  const prefs = new Set((prof.cuisine_prefs||[]).map(normalize))
  if (cz && prefs.has(cz)) score += 2

  const patt = normalize(prof.dietary_pattern||prof.meat_policy)
  const rp   = normalize(rec.dietary_pattern||'')
  if (patt && rp && (rp.includes('veg') === patt.includes('veg'))) score += 1

  return score
}

function chooseTopVaried(
  pool:Recipe[], count:number, rnd:()=>number, seen:Set<string>, prof:Profile, hintTags:string[], cuisineCap=2
){
  // Rank by score, then apply shuffle + cuisine distribution + seen filter
  const ranked = pool
    .map(r => ({ r, s: scoreRecipeForProfile(r, prof, hintTags) }))
    .sort((a,b) => b.s - a.s)

  // Take top 50 to allow some shuffle variety
  const top = ranked.slice(0, Math.max(10, Math.min(50, ranked.length))).map(x => x.r)
  const shuf = seededShuffle(top.length ? top : pool, rnd)

  const byCuisine = new Map<string,number>()
  const pick: Recipe[] = []
  for(const r of shuf){
    const key = normalize(r.name)
    if(!key || seen.has(key)) continue
    const cz = normalize(r.cuisine||'misc')
    const used = byCuisine.get(cz)||0
    if(used >= cuisineCap) continue
    pick.push(r)
    seen.add(key)
    byCuisine.set(cz, used+1)
    if(pick.length>=count) break
  }

  if(pick.length<count){
    for(const r of shuf){
      const key = normalize(r.name)
      if(!key || seen.has(key)) continue
      pick.push(r); seen.add(key)
      if(pick.length>=count) break
    }
  }
  return pick
}

/* ======================= Data access ======================= */

async function fetchAllRecipes(supa:any): Promise<Recipe[]>{
  const { data, error } = await supa
    .from('recipes')
    .select('name,dietary_pattern,allergens,tags,ingredients,cuisine')
    .limit(2000)
  if (error) throw error
  return (data as Recipe[]) || []
}

async function fetchAllExercises(supa:any): Promise<Exercise[]>{
  const { data, error } = await supa
    .from('exercises')
    .select('name,tags,equipment,contraindications,description')
    .limit(2000)
  if (error) throw error
  return (data as Exercise[]) || []
}

async function fetchSeenMealsInWindow(supa:any, userId:string, startISO:string, endISO:string){
  const { data } = await supa
    .from('meals')
    .select('recipe_name,plan_day_id,plan_days!inner(date)')
    .gte('plan_days.date', startISO)
    .lte('plan_days.date', endISO)
    .eq('plan_days.user_id', userId)
  const seen = new Set<string>()
  for (const r of (data||[]) as any[]){
    if (r.recipe_name) seen.add(normalize(r.recipe_name))
  }
  return seen
}

async function fetchSeenWorkoutsInWindow(supa:any, userId:string, startISO:string, endISO:string){
  const { data } = await supa
    .from('workout_blocks')
    .select('title,workout_day_id,workout_days!inner(date)')
    .gte('workout_days.date', startISO)
    .lte('workout_days.date', endISO)
    .eq('workout_days.user_id', userId)
  const seen = new Set<string>()
  for (const r of (data||[]) as any[]){
    if (r.title) seen.add(normalize(r.title))
  }
  return seen
}

/* ======================= Meal slot logic ======================= */

function clamp(n:number, lo:number, hi:number){ return Math.max(lo, Math.min(hi, n)) }

function deriveEatingWindow(prof: Profile){
  const startHM = toHM(prof.eating_window_start || '')
  const endHM   = toHM(prof.eating_window_end   || '')
  if (startHM && endHM) return { start: startHM, end: endHM }
  const fasting = typeof prof.fasting_hours === 'number' ? clamp(Math.round(prof.fasting_hours), 0, 23) : 16
  const eatHours = clamp(24 - fasting, 4, 14)
  const sH = 12, sM = 0
  const eH = (sH + eatHours) % 24, eM = sM
  return { start: [sH, sM] as [number,number], end: [eH, eM] as [number,number] }
}

function generateMealTimesLocal(prof: Profile, slots: number): string[] {
  const n = clamp(Number(prof.meals_per_day || slots || 3), 1, 6)
  const { start, end } = deriveEatingWindow(prof)
  const [sh, sm] = start, [eh, em] = end
  const S = sh*60 + sm
  let E = eh*60 + em
  if (E <= S) E += 24*60
  const windowMin = E - S
  if (n === 1) {
    const t = S + Math.floor(windowMin/2)
    const h = Math.floor((t % (24*60))/60), m = (t % 60)
    return [hmToStr(h,m)]
  }
  const step = Math.floor(windowMin / (n - 1))
  return Array.from({length:n}, (_,i)=>{
    const t = S + i*step
    const h = Math.floor((t % (24*60))/60), m = (t % 60)
    return hmToStr(h,m)
  })
}

function slotTagHints(total:number, idx:number): string[] {
  if (total<=1) return ['dinner','lunch']
  if (total===2) return idx===0 ? ['lunch'] : ['dinner','supper']
  if (total===3) return idx===0 ? ['breakfast'] : idx===1 ? ['lunch'] : ['dinner']
  const order = ['breakfast','snack','lunch','snack','dinner','snack']
  return [order[Math.min(idx, order.length-1)]]
}

/* ======================= Pickers (meals & workouts) ======================= */

async function pickMealsForDay(
  allRecipes:Recipe[], dayIndex:number, prof: Profile, rnd:()=>number,
  seenAcrossWindow:Set<string>, slots:number
){
  const times = generateMealTimesLocal(prof, slots)
  const picks: { meal_type: string, recipe_name: string, time_local?: string, alternates?: string[] }[] = []

  for (let i=0;i<slots;i++){
    const hints = slotTagHints(slots, i)
    const pool = allRecipes.filter(r => isRecipeAllowed(r, prof))
    const poolWithHints = pool.filter(r => {
      const tags = normalizeTags((r as any).tags)
      const nm = normalize(r.name)
      return hints.some(h => tags.includes(h) || nm.includes(h))
    })

    const chosen = chooseTopVaried(poolWithHints.length ? poolWithHints : pool,
                                   1, rnd, new Set(seenAcrossWindow), prof, hints)[0]
    const primaryName = chosen?.name || (i===0 ? 'Oat Bowl' : i===slots-1 ? 'Veg Stir Fry' : 'Chicken Wrap')

    // Build alternates (2) that are different from primary & not used this window
    const altSeen = new Set(seenAcrossWindow); altSeen.add(normalize(primaryName))
    const alts = chooseTopVaried(
      poolWithHints.length ? poolWithHints : pool, 5, rnd, altSeen, prof, hints
    ).map(r => r.name).filter(n => normalize(n) !== normalize(primaryName)).slice(0,2)

    seenAcrossWindow.add(normalize(primaryName))
    picks.push({
      meal_type: `meal_${i+1}`,
      recipe_name: primaryName,
      time_local: times[i],
      alternates: alts
    })
  }
  return picks
}

async function pickWorkoutForDay(
  allExercises:Exercise[], dayIndex:number, prof:Profile, rnd:()=>number,
  seenWorkoutsWindow:Set<string>
){
  const cycles = [
    { want: ['push','upper','chest','shoulder','triceps'] , key:'push'   },
    { want: ['pull','upper','back','biceps']               , key:'pull'   },
    { want: ['legs','lower','quad','hamstring','glute']    , key:'legs'   },
    { want: ['core','abs']                                 , key:'core'   },
    { want: ['hinge','posterior','deadlift']               , key:'hinge'  },
    { want: ['squat']                                      , key:'squat'  },
    { want: ['cardio','conditioning','hiit']               , key:'cardio' },
  ]
  const exs = allExercises.filter(e => isExerciseAllowed(e, prof))
  const used = new Set<string>()
  const focus = cycles[dayIndex % cycles.length]

  function takeByTagDistinct(tag:string){
    const pool = exs.filter(e => normalizeTags((e as any).tags).includes(tag))
    const shuf = seededShuffle(pool, rnd)
    for(const e of shuf){
      const key = normalize(e.name)
      if(!key || used.has(key) || seenWorkoutsWindow.has(key)) continue
      used.add(key)
      return e
    }
    return null
  }

  let primary: Exercise|null = null
  for (const t of focus.want) {
    primary = takeByTagDistinct(t)
    if (primary) break
  }
  if(!primary){
    const fallback = normalize('Bodyweight Squat')
    if (!seenWorkoutsWindow.has(fallback)) {
      seenWorkoutsWindow.add(fallback)
      primary = { name:'Bodyweight Squat', description:'3×12' } as Exercise
    } else {
      primary = { name:'Row (band)', description:'3×12' } as Exercise
    }
  } else {
    seenWorkoutsWindow.add(normalize(primary.name))
  }

  const others = seededShuffle(cycles.filter(c=>c.key!==focus.key), rnd).slice(0,2)
  const sec: Exercise[] = []
  for (const o of others) {
    let picked: Exercise|null = null
    for (const t of o.want) {
      picked = takeByTagDistinct(t)
      if (picked) break
    }
    if (picked) {
      seenWorkoutsWindow.add(normalize(picked.name))
      sec.push(picked)
    } else {
      const fb = o.key==='core' ? { name:'Plank', description:'3×30s' } : { name:'Row (band)', description:'3×12' }
      seenWorkoutsWindow.add(normalize(fb.name))
      sec.push(fb as Exercise)
    }
  }

  return [
    { kind:'warmup',  title:'Warm-up',  details:'5–8 min easy walk + mobility' },
    { kind:'circuit', title:primary.name, details: (primary as any).description || '3×12' },
    { kind:'circuit', title:sec[0].name,  details: (sec[0] as any).description || '3×12' },
    { kind:'circuit', title:sec[1].name,  details: (sec[1] as any).description || '3×12' },
    { kind:'cooldown',title:'Cooldown', details:'Stretch 5 min' },
  ]
}

/* ======================= Core rolling-window generator ======================= */

function dayIndexWithinWindow(start:Date, current:Date){
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const b = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())
  return Math.round((b - a) / (24*3600*1000)) // 0..6
}

async function ensureRollingWindowForUser(supa:any, userId:string, prof:Profile, startDateISO:string){
  // Window = start → start+6 (7 days)
  const [Y,M,D] = startDateISO.split('-').map(Number)
  const start = new Date(Date.UTC(Y, M-1, D))
  const dates = rangeDays(start, 7).map(ymdLocal)
  const windowStartISO = dates[0]
  const windowEndISO   = dates[6]

  // Seen sets across the WHOLE window (so we don’t repeat within these 7 days)
  const [seenMeals, seenWorkouts] = await Promise.all([
    fetchSeenMealsInWindow(supa, userId, windowStartISO, windowEndISO),
    fetchSeenWorkoutsInWindow(supa, userId, windowStartISO, windowEndISO),
  ])

  // Pre-fetch full candidate pools once (faster & consistent)
  const [allRecipes, allExercises] = await Promise.all([
    fetchAllRecipes(supa),
    fetchAllExercises(supa),
  ])

  // Ensure day rows & fill content per missing day, processing in chronological order
  const results:any[] = []

  for(const dateISO of dates){
    // ensure plan_day and workout_day rows exist
    const [{ data: pdRows }, { data: wdRows }] = await Promise.all([
      supa.from('plan_days').select('id').eq('user_id', userId).eq('date', dateISO).limit(1),
      supa.from('workout_days').select('id').eq('user_id', userId).eq('date', dateISO).limit(1),
    ])
    let planDayId = pdRows?.[0]?.id as string|undefined
    let workoutDayId = wdRows?.[0]?.id as string|undefined

    if(!planDayId){
      const { data, error } = await supa.from('plan_days').insert({ user_id:userId, date:dateISO }).select('id').single()
      if(error) throw error
      planDayId = data.id
    }
    if(!workoutDayId){
      const { data, error } = await supa.from('workout_days').insert({ user_id:userId, date:dateISO }).select('id').single()
      if(error) throw error
      workoutDayId = data.id
    }

    const [{ data: mealsExisting }, { data: blocksExisting }] = await Promise.all([
      supa.from('meals').select('id').eq('plan_day_id', planDayId),
      supa.from('workout_blocks').select('id').eq('workout_day_id', workoutDayId),
    ])

    const toInsertMeals_full:any[] = []     // with time_local + alternates if supported
    const toInsertMeals_timeOnly:any[] = [] // with time_local only
    const toInsertMeals_base:any[] = []     // bare minimum (no extra cols)
    const toInsertBlocks:any[] = []

    // Stable randomness per user + window + date
    const seed = hashString(`${userId}|${windowStartISO}|${dateISO}`)
    const rnd = mulberry32(seed)
    const idx = dayIndexWithinWindow(start, new Date(Date.UTC(
      Number(dateISO.slice(0,4)), Number(dateISO.slice(5,7))-1, Number(dateISO.slice(8,10))
    )))

    // --- MEALS ---
    if((mealsExisting||[]).length === 0){
      const slots = clamp(Number(prof.meals_per_day || 3), 1, 6)
      const picks = await pickMealsForDay(allRecipes, idx, prof, rnd, seenMeals, slots)

      for (const p of picks){
        const base = { meal_type: p.meal_type, recipe_name: p.recipe_name, plan_day_id: planDayId }
        toInsertMeals_full.push({ ...base, time_local: p.time_local, alternates: p.alternates })
        toInsertMeals_timeOnly.push({ ...base, time_local: p.time_local })
        toInsertMeals_base.push(base)
      }
    }

    // --- WORKOUTS ---
    if((blocksExisting||[]).length === 0){
      const blocks = await pickWorkoutForDay(allExercises, idx, prof, rnd, seenWorkouts)
      blocks.forEach(b => toInsertBlocks.push({ ...b, workout_day_id: workoutDayId }))
    }

    // Insert meals with graceful fallbacks for unknown columns
    if(toInsertMeals_full.length){
      let inserted = false
      const r1 = await supa.from('meals').insert(toInsertMeals_full)
      if (!r1.error) inserted = true
      if (!inserted){
        const r2 = await supa.from('meals').insert(toInsertMeals_timeOnly)
        if (!r2.error) inserted = true
      }
      if (!inserted){
        const r3 = await supa.from('meals').insert(toInsertMeals_base)
        if (r3.error) throw r3.error
      }
    }
    if(toInsertBlocks.length){
      const { error: blkErr } = await supa.from('workout_blocks').insert(toInsertBlocks)
      if (blkErr) throw blkErr
    }

    results.push({
      date: dateISO,
      meals_added: toInsertMeals_full.length || toInsertMeals_timeOnly.length || toInsertMeals_base.length,
      blocks_added: toInsertBlocks.length
    })
  }

  return results
}

/* ======================= Route handler ======================= */

function getQueryDate(req: Request): string | null {
  try {
    const url = new URL(req.url)
    const d = url.searchParams.get('start') || url.searchParams.get('date') // allow ?start=YYYY-MM-DD as override
    if(!d) return null
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
    return d
  } catch { return null }
}

export async function POST(req: Request){
  // Auth: shared secret header
  const key = req.headers.get('x-cron-key') || ''
  if(!process.env.CRON_SECRET || key !== process.env.CRON_SECRET){
    return NextResponse.json({ ok:false, error:'unauthorized' }, { status: 401 })
  }

  const supa = getAdminClient()

  // Rolling window start = today in London, unless ?start=YYYY-MM-DD provided
  const override = getQueryDate(req)
  const startDateISO = override || ymdLocal(nowInLondon())

  // Fetch all profiles
  const { data: profs, error: pErr } = await supa
    .from('profiles')
    .select(`
      id,
      dietary_pattern, meat_policy, allergies, dislikes, cuisine_prefs,
      injuries, health_conditions, equipment,
      meals_per_day, eating_window_start, eating_window_end, fasting_hours
    `)
  if(pErr) return NextResponse.json({ ok:false, error:pErr.message }, { status: 500 })

  let totalUsers = 0
  const perUser:any[] = []

  // For each user, ensure rolling 7-day window (today..today+6)
  for(const raw of (profs as Profile[] || [])){
    const uid = raw.id
    if(!uid) continue
    totalUsers++
    try{
      const res = await ensureRollingWindowForUser(supa, uid, raw, startDateISO)
      perUser.push({ user: uid, start: startDateISO, results: res })
    }catch(e:any){
      perUser.push({ user: uid, start: startDateISO, error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ ok:true, start: startDateISO, users: totalUsers, perUser })
}

export async function GET(req: Request){
  // allow manual testing with same header & optional ?start=YYYY-MM-DD
  return POST(req)
}
