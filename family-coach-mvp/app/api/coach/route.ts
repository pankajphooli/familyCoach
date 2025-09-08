import { NextResponse } from 'next/server'

// Force Node runtime so process.env works reliably on Vercel
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Simple health check: /api/coach (GET)
export async function GET() {
  const configured = !!process.env.OPENAI_API_KEY
  return NextResponse.json({ ok: true, configured })
}

type CoachPayload = {
  messages: { role: 'user' | 'assistant' | 'system', content: string }[],
  profile: any,
  week: any,
}

export async function POST(req: Request) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    return NextResponse.json({
      reply: "AI coach is not configured yet. Ask your admin to set OPENAI_API_KEY in Vercel.",
      actions: {}
    })
  }

  let body: CoachPayload
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ reply: 'Bad request body', actions: {}, error: String(e) }, { status: 400 })
  }

  const { messages = [], profile, week } = body || {}

  // Limit chat context to keep payload small
  const tail = messages.slice(-8)

  const system = `You are HouseholdHQ's fitness & nutrition coach.
Consider the user's dietary pattern, allergies, dislikes, cuisine preferences for MEALS.
For WORKOUTS, consider health conditions, injuries, available equipment.
Return a SHORT friendly reply plus a JSON "actions" object with keys:
- replaceMeals: [{date: 'YYYY-MM-DD', meal_type: 'breakfast|lunch|dinner', recipe_name: string}]
- addGrocery: [string]
- updateWorkouts: [{date: 'YYYY-MM-DD', blocks: [{kind:string,title:string,details:string}]}]
Only propose changes that respect constraints. If nothing to change, return empty arrays.`

  const userContext = { profile, currentWeek: week }

  const payload = {
    model: 'gpt-4o-mini',
    temperature: 0.4,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(userContext) },
      ...tail
    ],
    response_format: { type: 'json_object' }
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!resp.ok) {
      const text = await resp.text()
      return NextResponse.json({
        reply: 'The coach is having trouble responding.',
        actions: {},
        error: { status: resp.status, body: text }
      }, { status: 200 })
    }

    const data = await resp.json()
    let content = data?.choices?.[0]?.message?.content || '{}'
    try {
      const parsed = JSON.parse(content)
      if (!parsed.reply) parsed.reply = 'OK.'
      if (!parsed.actions) parsed.actions = {}
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ reply: content, actions: {} })
    }
  } catch (e:any) {
    return NextResponse.json({
      reply: 'Network error calling OpenAI.',
      actions: {},
      error: String(e?.message || e)
    }, { status: 200 })
  }
}
