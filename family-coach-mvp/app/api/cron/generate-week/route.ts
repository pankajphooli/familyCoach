import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'

// Run on the server (Node runtime)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
}

type Recipe = {
  name: string
  dietary_pattern?: string|null
  allergens?: string[]|null
  tags?: any // text | text[] | jsonb[]
  ingredients?: string[]|null
  cuisine?: string|null
}

type Exercise = {
  name: string
  tags?: any // text | text[] | jsonb[]
  equipment?: string[]|null
  contraindications?: string[]|null
  description?: string|null
}

/* ---------------- helpers ---------------- */

function ymdFromParts(y:number,m:number,d:number){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` }

// Get "now" in Europe/London and some date helpers
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

function ymdLocal(d:Date){
  return ymdFromParts(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate())
}

function mondayOfWeek(d: Date){
  const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = dd.getUTCDay() || 7 // 1..7, Monday=1
  if(dow>1){ dd.setUTCDate(dd.getUTCDate()-(dow-1)) }
  return dd
}
function addDays(d:Date, n:number){ const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x }
function rangeMonToSun(monday:Date){
  const arr: Date[] = []
  for(let i=0;i<7;i++){ arr.push(addDays(monday,i)) }
  return arr
}

function normalize(s?:string|null){ return (s||'').trim().toLowerCase() }

// Normalize any `tags` shape (text | text[] | jsonb -> text[] lowercased)
function normalizeTags(tags:any): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) {
    // text[] or jsonb[]
    return tags.map((t:any)=> normalize(typeof t === 'string' ? t : String(t)))
  }
  // assume comma/space separated string
  return String(tags)
    .split(/[,;|]/g)
    .map(x=>normalize(x))
    .filter(Boolean)
}

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

/* ------------- constraints & pickers -------------- */

function isRecipeAllowed(rec: Recipe, prof: Profile){
  const patt = normalize(prof.dietary_pattern||prof.meat_policy)
  const rp   = normalize(rec.dietary_pattern||'')
  const nm   = normalize(rec.name||'')
  const allergies = (prof.allergies||[]).map(normalize)
  const dislikes  = (prof.dislikes ||[]).map(normalize)
  const recAllergens: string[] = ((rec as any).allergens || []).map((x:any)=>normalize(String(x)))

  // Relaxed pattern compatibility: if profile is veg, recipe must be veg/vegan OR name must not include common meats.
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

// Pull broadly, then filter in code (robust to different DB tag shapes)
async function fetchAllRecipes(supa:any): Promise<Recipe[]>{
  const { data, error } = await supa
    .from('recipes')
    .select('name,dietary_pattern,allergens,tags,ingredients,cuisine')
    .limit(1000)
  if (error) throw error
  return (data as Recipe[]) || []
}

function chooseVaried(all:Recipe[], count:number, rnd:()=>number, seen:Set<string>, cuisineCap=2){
  const shuf = seededShuffle(all, rnd)
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

async function defaultsForMeals(dayIndex:number, prof: Profile, supa:any, rnd:()=>number){
  // Build candidate pools by tag in code
  const all = await fetchAllRecipes(supa)
  const tagWanted = ['Breakfast','Lunch','Dinner'] as const
  const pools: Record<(typeof tagWanted)[number], Recipe[]> = {
    Breakfast: [],
    Lunch: [],
    Dinner: []
  }

  for (const r of all) {
    const tags = normalizeTags((r as any).tags)
    // simple heuristics so it's resilient even if tags are missing:
    const nm = normalize(r.name)
    const has = (t:string)=> tags.includes(normalize(t))
    if (has('breakfast') || /oat|porridge|toast|pancake|smoothie|omelet|omelette|cereal|breakfast/.test(nm)) pools.Breakfast.push(r)
    if (has('lunch')     || /wrap|salad|bowl|sandwich|rice|noodle|lunch/.test(nm))            pools.Lunch.push(r)
    if (has('dinner')    || /curry|stir fry|pasta|roast|grill|casserole|dinner|biryani/.test(nm)) pools.Dinner.push(r)
  }

  // filter by profile allowances
  const B = pools.Breakfast.filter(r => isRecipeAllowed(r, prof))
  const L = pools.Lunch.filter(r => isRecipeAllowed(r, prof))
  const D = pools.Dinner.filter(r => isRecipeAllowed(r, prof))

  const seen = new Set<string>()
  const b = chooseVaried(B,1,rnd,seen)[0]?.name || 'Oat Bowl'
  const l = chooseVaried(L,1,rnd,seen)[0]?.name || 'Chicken Wrap'
  const d = chooseVaried(D,1,rnd,seen)[0]?.name || 'Veg Stir Fry'
  return [
    { meal_type:'breakfast', recipe_name:b },
    { meal_type:'lunch',     recipe_name:l },
    { meal_type:'dinner',    recipe_name:d },
  ]
}

async function filteredExercises(prof:Profile, supa:any): Promise<Exercise[]>{
  const { data, error } = await supa.from('exercises')
    .select('name,tags,equipment,contraindications,description')
    .limit(1000)
  if (error) throw error
  const list = (data as Exercise[]) || []
  return list.filter(ex => isExerciseAllowed(ex, prof))
}
function takeByTagDistinct(exs:Exercise[], tag:string, rnd:()=>number, used:Set<string>){
  const pool = exs.filter(e => normalizeTags((e as any).tags).includes(tag))
  const shuf = seededShuffle(pool, rnd)
  for(const e of shuf){
    const key = normalize(e.name)
    if(!key || used.has(key)) continue
    used.add(key)
    return e
  }
  return null
}
async function pickWorkoutFor(dayIndex:number, prof:Profile, supa:any, rnd:()=>number){
  const exs = await filteredExercises(prof, supa)
  const used = new Set<string>()

  // Be generous with tag names so it maps to common datasets
  const cycles = [
    { want: ['push','upper','chest','shoulder','triceps'] , key:'push'   },
    { want: ['pull','upper','back','biceps']               , key:'pull'   },
    { want: ['legs','lower','quad','hamstring','glute']    , key:'legs'   },
    { want: ['core','abs']                                 , key:'core'   },
    { want: ['hinge','posterior','deadlift']               , key:'hinge'  },
    { want: ['squat']                                      , key:'squat'  },
    { want: ['cardio','conditioning','hiit']               , key:'cardio' },
  ]
  const focus = cycles[dayIndex % cycles.length]

  let primary = null as Exercise|null
  for (const t of focus.want) {
    primary = takeByTagDistinct(exs, t, rnd, used)
    if (primary) break
  }
  if(!primary) primary = { name:'Bodyweight Squat', description:'3×12' }

  const others = seededShuffle(cycles.filter(c=>c.key!==focus.key), rnd).slice(0,2)
  const sec: Exercise[] = []
  for (const o of others) {
    let picked: Exercise|null = null
    for (const t of o.want) {
      picked = takeByTagDistinct(exs, t, rnd, used)
      if (picked) break
    }
    sec.push(picked || { name: o.key==='core' ? 'Plank' : 'Row (band)', description:o.key==='core' ? '3×30s' : '3×12' })
  }

  return [
    { kind:'warmup',  title:'Warm-up',  details:'5–8 min easy walk + mobility' },
    { kind:'circuit', title:primary.name, details: (primary as any).description || '3×12' },
    { kind:'circuit', title:sec[0].name,  details: (sec[0] as any).description || '3×12' },
    { kind:'circuit', title:sec[1].name,  details: (sec[1] as any).description || '3×12' },
    { kind:'cooldown',title:'Cooldown', details:'Stretch 5 min' },
  ]
}

/* ------------- core generation per user/day -------------- */

function dayIndexWithinWeek(target: Date){
  // Monday=0 ... Sunday=6 in London-local sense
  const mon = mondayOfWeek(target)
  const diffMs = (new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate())).getTime()
                - mon.getTime())
  return Math.round(diffMs / (24*3600*1000))
}

async function ensureDayForUser(supa:any, userId:string, prof:Profile, dateISO:string){
  // ensure plan_day and workout_day rows exist for this date
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

  // if meals/workout already exist, skip generation (idempotent)
  const [{ data: mealsExisting }, { data: blocksExisting }] = await Promise.all([
    supa.from('meals').select('id').eq('plan_day_id', planDayId),
    supa.from('workout_blocks').select('id').eq('workout_day_id', workoutDayId),
  ])

  const toInsertMeals:any[] = []
  const toInsertBlocks:any[] = []

  // seed: stable per user & date
  const seed = hashString(`${userId}|${dateISO}`)
  const rnd = mulberry32(seed)

  // dayIndex needed for meal/workout rotation (Mon..Sun)
  const parts = dateISO.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]))
  const idx = dayIndexWithinWeek(d)

  if((mealsExisting||[]).length === 0){
    const defs = await defaultsForMeals(idx, prof, supa, rnd)
    defs.forEach(m => toInsertMeals.push({ ...m, plan_day_id: planDayId }))
  }
  if((blocksExisting||[]).length === 0){
    const defsB = await pickWorkoutFor(idx, prof, supa, rnd)
    defsB.forEach(b => toInsertBlocks.push({ ...b, workout_day_id: workoutDayId }))
  }

  if(toInsertMeals.length) await supa.from('meals').insert(toInsertMeals)
  if(toInsertBlocks.length) await supa.from('workout_blocks').insert(toInsertBlocks)

  return {
    meals_added: toInsertMeals.length,
    blocks_added: toInsertBlocks.length
  }
}

/* ---------------- route handler ---------------- */

function getQueryDate(req: Request): string | null {
  try {
    const url = new URL(req.url)
    const d = url.searchParams.get('date')
    if(!d) return null
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
    return d
  } catch { return null }
}

export async function POST(req: Request){
  // simple shared secret to prevent public abuse
  const key = req.headers.get('x-cron-key') || ''
  if(!process.env.CRON_SECRET || key !== process.env.CRON_SECRET){
    return NextResponse.json({ ok:false, error:'unauthorized' }, { status: 401 })
  }

  const supa = getAdminClient()

  // target date = today in London unless override ?date=YYYY-MM-DD
  const override = getQueryDate(req)
  const targetDateISO = override || ymdLocal(nowInLondon())

  // fetch all users who have a profile
  const { data: profs, error: pErr } = await supa
    .from('profiles')
    .select('id,dietary_pattern,meat_policy,allergies,dislikes,cuisine_prefs,injuries,health_conditions,equipment')
  if(pErr) return NextResponse.json({ ok:false, error:pErr.message }, { status: 500 })

  let totalUsers = 0
  const results:any[] = []

  for(const raw of (profs as Profile[] || [])){
    const uid = raw.id
    if(!uid) continue
    totalUsers++
    try{
      const r = await ensureDayForUser(supa, uid, raw, targetDateISO)
      results.push({ user: uid, date: targetDateISO, ...r })
    }catch(e:any){
      results.push({ user: uid, date: targetDateISO, error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ ok:true, date: targetDateISO, users: totalUsers, results })
}

export async function GET(req: Request){
  // allow a GET ping for manual testing (same header)
  return POST(req)
}
