
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    return NextResponse.json({
      reply: "AI coach is not configured yet. Ask your admin to set OPENAI_API_KEY in Vercel.",
      actions: {}
    })
  }
  const body = await req.json()
  const { messages, profile, week } = body || {}

  const system = `You are HouseholdHQ's fitness & nutrition coach.
Consider the user's dietary pattern, allergies, dislikes, cuisine preferences for MEALS.
For WORKOUTS, consider health conditions, injuries, available equipment.
Return a SHORT friendly reply plus a JSON "actions" object with keys:
- replaceMeals: [{date: 'YYYY-MM-DD', meal_type: 'breakfast|lunch|dinner', recipe_name: string}]
- addGrocery: [string]
- updateWorkouts: [{date: 'YYYY-MM-DD', blocks: [{kind:string,title:string,details:string}]}]
Only propose changes that respect constraints. If nothing to change, return empty arrays.`

  const userContext = {
    profile,
    currentWeek: week
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userContext) },
        ...(messages || [])
      ],
      response_format: { type: 'json_object' }
    })
  })

  if (!resp.ok) {
    const err = await resp.text()
    return NextResponse.json({ reply: 'The coach is having trouble responding.', actions: {}, error: err }, { status: 200 })
  }

  const data = await resp.json()
  let content = data?.choices?.[0]?.message?.content || '{}'
  let parsed: any = {}
  try {
    parsed = JSON.parse(content)
  } catch(e) {
    parsed = { reply: content, actions: {} }
  }
  if (!parsed.actions) parsed.actions = {}
  if (!parsed.reply) parsed.reply = "OK."
  return NextResponse.json(parsed)
}
