import { createClient } from '@supabase/supabase-js'

export function createAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  const service = process.env.SUPABASE_SERVICE_ROLE as string
  if (!url || !service) {
    throw new Error('Missing SUPABASE env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE)')
  }
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
}
