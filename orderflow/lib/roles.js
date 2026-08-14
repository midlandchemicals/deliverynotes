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

// Rahul's login. The leads tracker is his alone (not shared with the other
// admins, Sunny & Louise), so it's gated on this specific address rather than
// the admin role. Kept here so the app and the SQL policy agree in one place.
export const RAHUL_EMAIL = 'rahul@midlandchem.com'

let cachedEmailPromise = null
export function fetchUserEmail() {
  if (!cachedEmailPromise) {
    cachedEmailPromise = (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        return (user?.email || '').trim().toLowerCase()
      } catch { return '' }
    })()
  }
  return cachedEmailPromise
}

export function fetchIsRahul() {
  return fetchUserEmail().then((email) => email === RAHUL_EMAIL)
}

// Allow re-check after sign-out/sign-in within the same tab.
export function resetRoleCache() { cachedPromise = null; cachedEmailPromise = null }
