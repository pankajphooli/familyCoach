import { NextResponse } from 'next/server'
import { makeAdminClient } from '../../../lib/supabaseAdmin'

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
  tags?: string[]|null
  ingredients?: string[]|null
  cuisine?: string|null
}

type Exercise = {
  name: string
  tags?: string[]|null
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
  const recAllergens: string[] = (rec.allergens || []).map(x=>normalize(String(x)))

  if(patt){
    if(patt==='veg' || patt.includes('vegetarian')){
      if(rp && !(rp.includes('veg'))) return false
      const banned = ['chicken','beef','pork','mutton','lamb','fish','tuna','salmon','prawn','shrimp','shellfish','bacon']
      if(banned.some(b => nm.includes(b))) return false
    }else if(patt==='non_veg_chicken_only'){
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
  const need: string[] = (ex.equipment||[]).map(x=>normalize(String(x)))
  const contra: string[] = (ex.contraindications||[]).map(x=>normalize(String(x)))
  const flags = new Set([...(prof.injuries||[]), ...(prof.health_conditions||[])].map(normalize))

  const okEquip = need.length===0 || need.includes('none') || need.every(n=>have.has(n))
  if(!okEquip) return false
  if(contra.length && [...flags].some(f => contra.includes(f))) return false
  return true
}

async function candidatesForTag(tag:string, prof:Profile, supa:any): Promise<Recipe[]>{
  let q = supa.from('recipes')
    .select('name,dietary_pattern,allergens,tags,ingredients,cuisine')
    .ilike('tags', `%${tag}%`)
    .limit(250)
  if(prof.dietary_pattern){ q = q.eq('dietary_pattern', prof.dietary_pattern) }
  const { data } = await q
  const list = (data as Recipe[]) || []
  return list.filter(r => isRecipeAllowed(r, prof))
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
  const [B,L,D] = await Promise.all([
    candidatesForTag('Breakfast', prof, supa),
    candidatesForTag('Lunch', prof, supa),
    candidatesForTag('Dinner', prof, supa),
  ])
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
  const { data } = await supa.from('exercises')
    .select('name,tags,equipment,contraindications,description')
    .limit(300)
  const list = (data as Exercise[]) || []
  return list.filter(ex => isExerciseAllowed(ex, prof))
}
function takeByTagDistinct(exs:Exercise[], tag:string, rnd:()=>number, used:Set<string>){
  const pool = exs.filter(e => (e.tags||[]).map(normalize).includes(tag))
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
  const cycle = ['push','pull','legs','core','hinge','squat','cardio']
  const focus = cycle[dayIndex % cycle.length]

  const primary = takeByTagDistinct(exs, focus, rnd, used) || { name:'Bodyweight Squat', description:'3×12' }
  const otherTags = seededShuffle(cycle.filter(t=>t!==focus), rnd).slice(0,2)
  const secA = takeByTagDistinct(exs, otherTags[0], rnd, used) || { name:'Row (band)', description:'3×12' }
  const secB = takeByTagDistinct(exs, otherTags[1], rnd, used) || { name:'Plank', description:'3×30s' }

  return [
    { kind:'warmup',  title:'Warm-up',  details:'5–8 min easy walk + mobility' },
    { kind:'circuit', title:primary.name, details: primary.description || '3×12' },
    { kind:'circuit', title:secA.name,    details: secA.description || '3×12' },
    { kind:'circuit', title:secB.name,    details: secB.description || '3×12' },
    { kind:'cooldown',title:'Cooldown', details:'Stretch 5 min' },
  ]
}

/* ------------- core generation per user/week -------------- */

async function ensureWeekForUser(supa:any, userId:string, prof:Profile, monday:Date){
  const mondayStr = ymdLocal(monday)
  const dates = rangeMonToSun(monday).map(ymdLocal)

  // ensure days exist
  const [pds, wds] = await Promise.all([
    supa.from('plan_days').select('id,date').eq('user_id', userId).in('date', dates),
    supa.from('workout_days').select('id,date').eq('user_id', userId).in('date', dates),
  ])

  const havePd = new Map<string,string>()
  const haveWd = new Map<string,string>()
  ;(pds.data||[]).forEach((r:any)=> havePd.set(r.date, r.id))
  ;(wds.data||[]).forEach((r:any)=> haveWd.set(r.date, r.id))

  const pdMissing = dates.filter(d => !havePd.has(d)).map(d => ({ user_id:userId, date:d }))
  const wdMissing = dates.filter(d => !haveWd.has(d)).map(d => ({ user_id:userId, date:d }))
  if(pdMissing.length) await supa.from('plan_days').insert(pdMissing)
  if(wdMissing.length) await supa.from('workout_days').insert(wdMissing)

  // refresh maps after potential inserts
  const [pds2, wds2] = await Promise.all([
    supa.from('plan_days').select('id,date').eq('user_id', userId).in('date', dates),
    supa.from('workout_days').select('id,date').eq('user_id', userId).in('date', dates),
  ])
  const pdByDate:Record<string,string> = {}; (pds2.data||[]).forEach((r:any)=>pdByDate[r.date]=r.id)
  const wdByDate:Record<string,string> = {}; (wds2.data||[]).forEach((r:any)=>wdByDate[r.date]=r.id)

  // which days already have content?
  const [mealsAll, blocksAll] = await Promise.all([
    supa.from('meals').select('id,plan_day_id').in('plan_day_id', Object.values(pdByDate)),
    supa.from('workout_blocks').select('id,workout_day_id').in('workout_day_id', Object.values(wdByDate)),
  ])
  const pdWithMeals = new Set((mealsAll.data||[]).map((m:any)=>m.plan_day_id))
  const wdWithBlocks = new Set((blocksAll.data||[]).map((b:any)=>b.workout_day_id))

  const mealsToInsert:any[] = []
  const blocksToInsert:any[] = []

  for(let i=0;i<dates.length;i++){
    const date = dates[i]
    const seed = hashString(`${userId}|${mondayStr}|${date}`)
    const rnd = mulberry32(seed)

    const pdId = pdByDate[date]
    const wdId = wdByDate[date]

    if(pdId && !pdWithMeals.has(pdId)){
      const defs = await defaultsForMeals(i, prof, supa, rnd)
      defs.forEach(m => mealsToInsert.push({ ...m, plan_day_id: pdId }))
    }
    if(wdId && !wdWithBlocks.has(wdId)){
      const defsB = await pickWorkoutFor(i, prof, supa, rnd)
      defsB.forEach(b => blocksToInsert.push({ ...b, workout_day_id: wdId }))
    }
  }

  if(mealsToInsert.length) await supa.from('meals').insert(mealsToInsert)
  if(blocksToInsert.length) await supa.from('workout_blocks').insert(blocksToInsert)

  return { meals: mealsToInsert.length, blocks: blocksToInsert.length }
}

/* ---------------- route handler ---------------- */

export async function POST(req: Request){
  // simple shared secret to prevent public abuse
  const key = req.headers.get('x-cron-key') || ''
  if(!process.env.CRON_SECRET || key !== process.env.CRON_SECRET){
    return NextResponse.json({ ok:false, error:'unauthorized' }, { status: 401 })
  }

  const supa = getAdminClient()

  // figure out weeks in London time:
  const now = nowInLondon()
  const thisMon = mondayOfWeek(now)
  const nextMon = addDays(thisMon, 7)

  // We generate both:
  //  - remaining days of this week (in case someone joined mid-week)
  //  - the entire next week (so grocery can be bought 2–3 days ahead)
  const weeksToEnsure = [thisMon, nextMon]

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

    for(const wk of weeksToEnsure){
      const r = await ensureWeekForUser(supa, uid, raw, wk)
      results.push({ user: uid, monday: ymdLocal(wk), ...r })
    }
  }

  return NextResponse.json({ ok:true, users: totalUsers, results })
}

export async function GET(req: Request){
  // optional: allow a GET ping for manual testing (with the same header)
  return POST(req)
}
