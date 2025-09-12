import { createClient } from '@supabase/supabase-js'

function _makeAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// Preferred export name:
export function createAdminClient() {
  return _makeAdmin()
}

// Compatibility alias if other code referenced a different name:
export function getAdminClient() {
  return _makeAdmin()
}
