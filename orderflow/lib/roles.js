import { createClient } from '@/lib/supabase/client'

// Role lookup for the logged-in user against the app_users table.
//   role 'admin'   → sees pricing everywhere (Rahul / Sunny / Louise)
//   role 'general' → pricing is hidden completely (Rob / Office)
//
// Safety valves so nobody is ever locked out of a working app:
//  - table missing or empty  → everyone is treated as admin (pre-migration)
//  - logged-in email not in the table → treated as GENERAL (add all users!)
let cachedPromise = null

export function fetchIsAdmin() {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const email = (user?.email || '').trim().toLowerCase()
        const { data, error } = await supabase.from('app_users').select('email, role')
        if (error || !Array.isArray(data) || data.length === 0) return true // table not set up yet
        const row = data.find((r) => (r.email || '').trim().toLowerCase() === email)
        return row ? row.role === 'admin' : false
      } catch {
        return true
      }
    })()
  }
  return cachedPromise
}

// Allow re-check after sign-out/sign-in within the same tab.
export function resetRoleCache() { cachedPromise = null }
