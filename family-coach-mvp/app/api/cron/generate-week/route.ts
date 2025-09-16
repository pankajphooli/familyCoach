import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ======================= Types ======================= */

type Raw = any

type Profile = {
  id: string
  dietary_pattern?: string|null
  meat_policy?: string|null
  allergies?: string[]|null
  dislikes?: string[]|null
  cuisine_prefs?: string[]|null
  injuries?: string[]|null
  health_conditions?: string[]|null
  equipment?: string[]|null
  meals_per_day?: number|null
  eating_window_start?: string|null   // "HH:MM"
  eating_window_end?: string|null     // "HH:MM"
  fasting_hours?: number|null         // e.g. 16
}

type Recipe = {
  name: string
  dietary_pattern?: string|null
  allergens?: string[]|null
  tags?: any
  ingredients?: string[]|null
  cuisine?: string|null
}

type Exercise = {
  name: string
  tags?: any
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

/* ======================= Utils & normalization ======================= */

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

/* ---- robust list parsing for text/jsonb/array ---- */
function toList(val: any): string[] {
  if (val == null) return []
  if (Array.isArray(val)) return val.map(v => String(v)).map(s => s.trim()).filter(Boolean)
  const s = String(val).trim()
  if (!s) return []
  // Try JSON array
  if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    try {
      const j = JSON.parse(s)
      if (Array.isArray(j)) return j.map(v=>String(v)).map(x=>x.trim()).filter(Boolean)
    } catch {}
  }
  // CSV / semi / pipe / newline
  return s.split(/[,\n;|]/g).map(x => x.trim()).filter(Boolean)
}

function normalizeTags(tags:any): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags.map((t:any)=> normalize(typeof t === 'string' ? t : String(t)))
  return String(tags).split(/[,;|]/g).map(x=>normalize(x)).filter(Boolean)
}

/* ---- fasting window parser (handles "16:8" or "12:00-20:00") ---- */
function parseFastingWindow(val: any): { fasting_hours?: number|null, eating_window_start?: string|null, eating_window_end?: string|null } {
  const s = (val==null) ? '' : String(val).trim()
  if (!s) return {}
  // Format: "HH:MM-HH:MM"
  let m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s)
  if (m) {
    const sh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2,'0')
    const sm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2,'0')
    const eh = String(Math.max(0, Math.min(23, Number(m[3])))).padStart(2,'0')
    const em = String(Math.max(0, Math.min(59, Number(m[4])))).padStart(2,'0')
    return { eating_window_start:`${sh}:${sm}`, eating_window_end:`${eh}:${em}` }
  }
  // Format: "HH-HH"
  m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(s)
  if (m) {
    const sh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2,'0')
    const eh = String(Math.max(0, Math.min(23, Number(m[2])))).padStart(2,'0')
    return { eating_window_start:`${sh}:00`, eating_window_end:`${eh}:00` }
  }
  // Format: "fast:eat" e.g. "16:8"
  m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(s)
  if (m) {
    return { fasting_hours: Math.max(0, Math.min(23, Number(m[1]))) }
  }
  return {}
}

/* ======================= Constraints & scoring ======================= */

function isRecipeAllowed(rec: Recipe, prof: Profile){
  const patt = normalize(prof.dietary_pattern||prof.meat_policy)
  const rp   = normalize((rec as any).dietary_pattern || '')
  const nm   = normalize(rec.name||'')
  const allergies = (prof.allergies||[]).map(normalize)
  const dislikes  = (prof.dislikes ||[]).map(normalize)
  const recAllergens: string[] = toList((rec as any).allergens).map(x=>normalize(x))

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
  const need: string[] = toList((ex as any).equipment).map(x=>normalize(x))
  const contra: string[] = toList((ex as any).contraindications).map(x=>normalize(x))
  const flags = new Set([...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalize))
  const okEquip = need.length===0 || need.includes('none') || need.every(n=>have.has(n))
  if(!okEquip) return false
  if(contra.length && [...flags].some(f => contra.includes(f))) return false
  return true
}

function scoreRecipeForProfile(rec:Recipe, prof:Profile, hintTags:string[]){
  let score = 0
  const tags = normalizeTags((rec as any).tags)
  const name = normalize(rec.name)
  const hints = new Set(hintTags.map(normalize))
  for(const h of hints){ if(tags.includes(h) || name.includes(h)) score += 3 }

  const cz = normalize(rec.cuisine||'')
  const prefs = new Set((prof.cuisine_prefs||[]).map(normalize))
  if (cz && prefs.has(cz)) score += 2

  const patt = normalize(prof.dietary_pattern||prof.meat_policy)
  const rp   = normalize((rec as any).dietary_pattern || '')
  if (patt && rp && (rp.includes('veg') === patt.includes('veg'))) score += 1

  return score
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

/* ===== seen-sets (IDs first, then child rows) ===== */

async function getPlanDayIdsInWindow(supa:any, userId:string, startISO:string, endISO:string){
  const { data } = await supa
    .from('plan_days')
    .select('id')
    .eq('user_id', userId)
    .gte('date', startISO)
    .lte('date', endISO)
  return ((data||[]) as any[]).map(r=>r.id)
}
async function getWorkoutDayIdsInWindow(supa:any, userId:string, startISO:string, endISO:string){
  const { data } = await supa
    .from('workout_days')
    .select('id')
    .eq('user_id', userId)
    .gte('date', startISO)
    .lte('date', endISO)
  return ((data||[]) as any[]).map(r=>r.id)
}

async function fetchSeenMealsInWindow(supa:any, planDayIds:string[]){
  if (!planDayIds.length) return new Set<string>()
  const { data } = await supa
    .from('meals')
    .select('recipe_name,plan_day_id')
    .in('plan_day_id', planDayIds)
  const seen = new Set<string>()
  for (const r of (data||[]) as any[]){ if (r.recipe_name) seen.add(normalize(r.recipe_name)) }
  return seen
}
async function fetchSeenWorkoutsInWindow(supa:any, workoutDayIds:string[]){
  if (!workoutDayIds.length) return new Set<string>()
  const { data } = await supa
    .from('workout_blocks')
    .select('title,workout_day_id')
    .in('workout_day_id', workoutDayIds)
  const seen = new Set<string>()
  for (const r of (data||[]) as any[]){ if (r.title) seen.add(normalize(r.title)) }
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

/* ======================= Fallback menus (rotating) ======================= */

const FALLBACKS = {
  breakfast: ['Oat Bowl','Greek Yogurt Parfait','Veggie Omelette','Smoothie Bowl','Chia Pudding','Peanut Butter Toast'],
  lunch:     ['Chicken Wrap','Quinoa Salad','Chickpea Salad Bowl','Grilled Veg Sandwich','Pasta Salad','Turkey Sandwich'],
  dinner:    ['Veg Stir Fry','Grilled Chicken & Veg','Lentil Curry','Tofu Teriyaki Bowl','Paneer Tikka Bowl','Salmon & Greens'],
  snack:     ['Fruit & Nuts','Yogurt & Berries','Hummus & Veg Sticks','Protein Shake','Apple & Peanut Butter','Trail Mix']
}
function fallbackByHint(hint:string){ 
  if (hint.includes('breakfast')) return FALLBACKS.breakfast
  if (hint.includes('lunch'))     return FALLBACKS.lunch
  if (hint.includes('dinner')||hint.includes('supper')) return FALLBACKS.dinner
  return FALLBACKS.snack
}

/* ======================= Pickers (meals & workouts) ======================= */

function chooseTopVaried(pool:Recipe[], count:number, rnd:()=>number, seen:Set<string>, prof:Profile, hintTags:string[], cuisineCap=2){
  const ranked = pool
    .map(r => ({ r, s: scoreRecipeForProfile(r, prof, hintTags) }))
    .sort((a,b) => b.s - a.s)
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

async function pickMealsForDay(allRecipes:Recipe[], dayIndex:number, prof: Profile, rnd:()=>number, seenAcrossWindow:Set<string>, slots:number, userSeed:number){
  const times = generateMealTimesLocal(prof, slots)
  const picks: { meal_type: string, recipe_name: string, time_local?: string, alternates?: string[] }[] = []
  const allowed = allRecipes.filter(r => isRecipeAllowed(r, prof))
  const prefs = new Set((prof.cuisine_prefs||[]).map(normalize))

  for (let i=0;i<slots;i++){
    const hints = slotTagHints(slots, i)
    let pool = allowed.filter(r => {
      const tags = normalizeTags((r as any).tags)
      const nm = normalize(r.name)
      return hints.some(h => tags.includes(h) || nm.includes(h))
    })
    if (pool.length < 6) {
      if (prefs.size){
        const prefed = allowed.filter(r => prefs.has(normalize(r.cuisine||'')))
        pool = Array.from(new Set([...pool, ...prefed]))
      }
      if (pool.length < 6) pool = allowed.slice()
    }

    const snap = new Set<string>(seenAcrossWindow)
    const chosen = chooseTopVaried(pool, 1, rnd, snap, prof, hints)[0]

    let primaryName: string
    if (chosen && chosen.name) {
      primaryName = chosen.name
    } else {
      const fb = fallbackByHint(hints[0])
      const idx = (userSeed + dayIndex*7 + i) % fb.length
      primaryName = fb[idx]
      if (seenAcrossWindow.has(normalize(primaryName))) {
        primaryName = fb[(idx+1) % fb.length]
      }
    }
    seenAcrossWindow.add(normalize(primaryName))

    const altSeen = new Set<string>(seenAcrossWindow); altSeen.add(normalize(primaryName))
    const alts = chooseTopVaried(pool, 5, rnd, altSeen, prof, hints)
      .map(r => r.name)
      .filter(n => normalize(n) !== normalize(primaryName))
      .slice(0,2)

    while (alts.length < 2){
      const fb = fallbackByHint(hints[0])
      const idx = (userSeed + dayIndex*13 + i*3 + alts.length + 1) % fb.length
      const candidate = fb[idx]
      if (normalize(candidate) !== normalize(primaryName) && !alts.some(a=>normalize(a)===normalize(candidate))) {
        alts.push(candidate)
      } else {
        break
      }
    }

    picks.push({
      meal_type: `meal_${i+1}`,
      recipe_name: primaryName,
      time_local: times[i],
      alternates: alts
    })
  }

  return picks
}

async function pickWorkoutForDay(allExercises:Exercise[], dayIndex:number, prof:Profile, rnd:()=>number, seenWorkoutsWindow:Set<string>, userSeed:number){
  const cycles = [
    { want: ['push','upper','chest','shoulder','triceps'] , key:'push',   fb: ['Push-ups','Dumbbell Shoulder Press','Triceps Dips'] },
    { want: ['pull','upper','back','biceps']               , key:'pull',   fb: ['Band Row','Face Pull (band)','Reverse Fly (band)'] },
    { want: ['legs','lower','quad','hamstring','glute']    , key:'legs',   fb: ['Bodyweight Squat','Lunge','Glute Bridge'] },
    { want: ['core','abs']                                 , key:'core',   fb: ['Plank','Dead Bug','Side Plank'] },
    { want: ['hinge','posterior','deadlift']               , key:'hinge',  fb: ['Hip Hinge (band RDL)','Good Morning','Glute Bridge'] },
    { want: ['squat']                                      , key:'squat',  fb: ['Goblet Squat','Split Squat','Box Squat'] },
    { want: ['cardio','conditioning','hiit']               , key:'cardio', fb: ['Brisk Walk 25min','Cycling 20min','Jump Rope Intervals'] },
  ]
  const exs = allExercises.filter(e => isExerciseAllowed(e, prof))
  const focus = cycles[dayIndex % cycles.length]
  const used = new Set<string>()

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

  function rotateFallback(arr:string[], offset:number){
    const i = (userSeed + dayIndex*5 + offset) % arr.length
    let name = arr[i]
    if (seenWorkoutsWindow.has(normalize(name))) name = arr[(i+1)%arr.length]
    return name
  }

  let primary: Exercise|null = null
  for (const t of focus.want) { primary = takeByTagDistinct(t); if (primary) break }
  if (!primary){
    const name = rotateFallback(focus.fb, 0)
    primary = { name, description:'3×12' } as Exercise
  }
  seenWorkoutsWindow.add(normalize(primary.name))

  const others = seededShuffle(cycles.filter(c=>c.key!==focus.key), rnd).slice(0,2)
  const sec: Exercise[] = []
  for (let k=0;k<others.length;k++){
    const o = others[k]
    let picked: Exercise|null = null
    for (const t of o.want) { picked = takeByTagDistinct(t); if (picked) break }
    if (!picked){
      const name = rotateFallback(o.fb, k+1)
      picked = { name, description: o.key==='core' ? '3×30s' : '3×12' } as Exercise
    }
    seenWorkoutsWindow.add(normalize(picked.name))
    sec.push(picked)
  }

  return [
    { kind:'warmup',  title:'Warm-up',  details:'5–8 min easy walk + mobility' },
    { kind:'circuit', title:primary.name, details: (primary as any).description || '3×12' },
    { kind:'circuit', title:sec[0].name,  details: (sec[0] as any).description || '3×12' },
    { kind:'circuit', title:sec[1].name,  details: (sec[1] as any).description || '3×12' },
    { kind:'cooldown',title:'Cooldown', details:'Stretch 5 min' },
  ]
}

/* ======================= Rolling 7-day generator ======================= */

async function ensureRollingWindowForUser(supa:any, userId:string, prof:Profile, startDateISO:string){
  const [Y,M,D] = startDateISO.split('-').map(Number)
  const start = new Date(Date.UTC(Y, M-1, D))
  const dates = rangeDays(start, 7).map(ymdLocal)
  const windowStartISO = dates[0]
  const windowEndISO   = dates[6]

  const [planIds, workoutIds] = await Promise.all([
    getPlanDayIdsInWindow(supa, userId, windowStartISO, windowEndISO),
    getWorkoutDayIdsInWindow(supa, userId, windowStartISO, windowEndISO),
  ])
  const [seenMeals, seenWorkouts] = await Promise.all([
    fetchSeenMealsInWindow(supa, planIds),
    fetchSeenWorkoutsInWindow(supa, workoutIds),
  ])

  const [allRecipes, allExercises] = await Promise.all([ fetchAllRecipes(supa), fetchAllExercises(supa) ])

  const results:any[] = []
  const userSeed = hashString(userId)

  for(const dateISO of dates){
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

    const toInsertMeals_full:any[] = []
    const toInsertMeals_timeOnly:any[] = []
    const toInsertMeals_base:any[] = []
    const toInsertBlocks:any[] = []

    const dayIdx = Math.round((new Date(dateISO).getTime() - new Date(windowStartISO).getTime())/(24*3600*1000))
    const seed = hashString(`${userId}|${windowStartISO}|${dateISO}`)
    const rnd = mulberry32(seed)

    if((mealsExisting||[]).length === 0){
      const slots = clamp(Number(prof.meals_per_day || 3), 1, 6)
      const picks = await pickMealsForDay(allRecipes, dayIdx, prof, rnd, seenMeals, slots, userSeed)
      for (const p of picks){
        const base = { meal_type: p.meal_type, recipe_name: p.recipe_name, plan_day_id: planDayId }
        toInsertMeals_full.push({ ...base, time_local: p.time_local, alternates: p.alternates })
        toInsertMeals_timeOnly.push({ ...base, time_local: p.time_local })
        toInsertMeals_base.push(base)
        seenMeals.add(normalize(p.recipe_name))
      }
    }

    if((blocksExisting||[]).length === 0){
      const blocks = await pickWorkoutForDay(allExercises, dayIdx, prof, rnd, seenWorkouts, userSeed)
      blocks.forEach(b => {
        toInsertBlocks.push({ ...b, workout_day_id: workoutDayId })
        if (b.title) seenWorkouts.add(normalize(b.title))
      })
    }

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

/* ======================= Profile normalization ======================= */

function normalizeProfile(raw: Raw): Profile {
  const cuisines = toList(raw.cuisine_prefs ?? raw.cuisines)
  const allergies = toList(raw.allergies)
  const dislikes  = toList(raw.dislikes)
  const injuries  = toList(raw.injuries)
  const conditions= toList(raw.health_conditions ?? raw.conditions)
  const equipment = toList(raw.equipment)
  const fw = parseFastingWindow(raw.fasting_window)
  const eatingStart = raw.eating_window_start ?? fw.eating_window_start ?? null
  const eatingEnd   = raw.eating_window_end   ?? fw.eating_window_end   ?? null
  const fastingHrs  = raw.fasting_hours ?? fw.fasting_hours ?? null

  return {
    id: raw.id,
    dietary_pattern: raw.dietary_pattern ?? raw.meat_policy ?? null,
    meat_policy: raw.meat_policy ?? null,
    cuisine_prefs: cuisines.length ? cuisines : null,
    allergies: allergies.length ? allergies : null,
    dislikes: dislikes.length ? dislikes : null,
    injuries: injuries.length ? injuries : null,
    health_conditions: conditions.length ? conditions : null,
    equipment: equipment.length ? equipment : null,
    meals_per_day: raw.meals_per_day ?? null,
    eating_window_start: eatingStart,
    eating_window_end: eatingEnd,
    fasting_hours: fastingHrs
  }
}

/* ======================= Route handler ======================= */

function getQueryStart(req: Request): string | null {
  try {
    const url = new URL(req.url)
    const d = url.searchParams.get('start') || url.searchParams.get('date')
    if(!d) return null
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
    return d
  } catch { return null }
}

export async function POST(req: Request){
  const key = req.headers.get('x-cron-key') || ''
  if(!process.env.CRON_SECRET || key !== process.env.CRON_SECRET){
    return NextResponse.json({ ok:false, error:'unauthorized' }, { status: 401 })
  }

  const supa = getAdminClient()
  const override = getQueryStart(req)
  const startDateISO = override || ymdLocal(nowInLondon())

  // fetch broadly; we normalize to handle schema diffs
const { data: rows, error: pErr } = await supa
  .from('profiles')
  .select('*') 
  
  if(pErr) return NextResponse.json({ ok:false, error:pErr.message }, { status: 500 })

  const profs: Profile[] = (rows||[]).map(normalizeProfile)

  let totalUsers = 0
  const perUser:any[] = []

  for(const prof of profs){
    const uid = prof.id
    if(!uid) continue
    totalUsers++
    try{
      const res = await ensureRollingWindowForUser(supa, uid, prof, startDateISO)
      perUser.push({ user: uid, start: startDateISO, results: res })
    }catch(e:any){
      perUser.push({ user: uid, start: startDateISO, error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ ok:true, start: startDateISO, users: totalUsers, perUser })
}

export async function GET(req: Request){
  return POST(req)
}
