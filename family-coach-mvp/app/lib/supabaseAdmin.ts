import { createClient } from '@supabase/supabase-js'

export function createAdmin(){
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  const service = process.env.SUPABASE_SERVICE_ROLE as string
  if (!url || !service) throw new Error('Missing Supabase env vars')
  return createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
}
