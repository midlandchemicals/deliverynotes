import { createClient } from '@supabase/supabase-js'

// Service-role client for server-only use (route handlers). Bypasses RLS, so
// NEVER import this into a client component. Needs SUPABASE_SERVICE_ROLE_KEY.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
