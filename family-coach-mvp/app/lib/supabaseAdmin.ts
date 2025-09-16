import { createClient, SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  // Accept either SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL for safety
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL

  // Accept common env names for service key
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE

  if (!url) {
    throw new Error('Supabase admin: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is missing')
  }
  if (!serviceKey) {
    throw new Error('Supabase admin: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE) is missing')
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'family-coach-admin' } },
    })
  }
  return adminClient
}
