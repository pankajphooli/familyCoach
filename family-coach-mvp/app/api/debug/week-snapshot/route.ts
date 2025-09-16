import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function ymd(d: Date){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}
function addDays(d:Date,n:number){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function mondayOfWeek(d:Date){const dt=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const dow=dt.getUTCDay()||7;if(dow>1)dt.setUTCDate(dt.getUTCDate()-(dow-1));return dt}
function nowLondon(){
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
  const p=Object.fromEntries(fmt.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return new Date(Date.UTC(+p.year, +p.month-1, +p.day))
}

export async function GET(req: Request){
  const url = new URL(req.url)
  const user = url.searchParams.get('user')
  if(!user) return NextResponse.json({ ok:false, error:'missing ?user=' }, { status:400 })

  const supa = getAdminClient()
  const today = nowLondon()
  const mon = mondayOfWeek(today)
  const dates = Array.from({length:7},(_,i)=> ymd(addDays(mon,i)))
  const startISO = dates[0], endISO = dates[6]

  const { data: planDays } = await supa.from('plan_days')
    .select('id,date')
    .eq('user_id', user)
    .gte('date', startISO)
    .lte('date', endISO)
    .order('date', { ascending: true })

  const idsPd = (planDays||[]).map((r:any)=>r.id)
  const { data: meals } = idsPd.length ? await supa.from('meals')
    .select('id,plan_day_id,meal_type,recipe_name,time_local,alternates')
    .in('plan_day_id', idsPd)
    .order('plan_day_id', { ascending: true })
    .order('meal_type', { ascending: true })
    : { data: [] }

  const { data: workDays } = await supa.from('workout_days')
    .select('id,date')
    .eq('user_id', user)
    .gte('date', startISO)
    .lte('date', endISO)
    .order('date', { ascending: true })

  const idsWd = (workDays||[]).map((r:any)=>r.id)
  const { data: blocks } = idsWd.length ? await supa.from('workout_blocks')
    .select('id,workout_day_id,kind,title,details')
    .in('workout_day_id', idsWd)
    .order('workout_day_id', { ascending: true })
    : { data: [] }

  const byPd = new Map<string, any[]>(); (meals||[]).forEach((m:any)=>{
    const k = String(m.plan_day_id); if(!byPd.has(k)) byPd.set(k, []); byPd.get(k)!.push(m)
  })
  const byWd = new Map<string, any[]>(); (blocks||[]).forEach((b:any)=>{
    const k = String(b.workout_day_id); if(!byWd.has(k)) byWd.set(k, []); byWd.get(k)!.push(b)
  })

  const out = dates.map(d => {
    const pd = (planDays||[]).find((x:any)=>x.date===d)
    const wd = (workDays||[]).find((x:any)=>x.date===d)
    return {
      date: d,
      meals: pd ? (byPd.get(pd.id)||[]) : [],
      workout: wd ? (byWd.get(wd.id)||[]) : []
    }
  })

  return NextResponse.json({ ok:true, week: { start: startISO, end: endISO, user }, days: out })
}
