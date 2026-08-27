import { createClient } from '@/lib/supabase/client'

// Role lookup for the logged-in user against the app_users table.
//   role 'admin'      → sees pricing everywhere (Rahul / Sunny / Louise)
//   role 'purchasing' → NOT an admin, but may open the Purchasing tab (Rob)
//   role 'general'    → pricing is hidden completely (Office)
//
// Safety valves so nobody is ever locked out of a working app:
//  - table missing or empty  → everyone is treated as admin (pre-migration)
//  - logged-in email not in the table → treated as GENERAL (add all users!)
let cachedPromise = null

// The signed-in user's role, looked up once. '' when it can't be read.
// A missing/empty table returns 'admin' so nothing breaks before setup.
function fetchRole() {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const email = (user?.email || '').trim().toLowerCase()
        const { data, error } = await supabase.from('app_users').select('email, role')
        if (error || !Array.isArray(data) || data.length === 0) return 'admin' // table not set up yet
        const row = data.find((r) => (r.email || '').trim().toLowerCase() === email)
        return row ? row.role : 'general'
      } catch {
        return 'admin'
      }
    })()
  }
  return cachedPromise
}

export function fetchIsAdmin() {
  return fetchRole().then((role) => role === 'admin')
}

// Purchasing is normally admin-only, but Rob is allowed in without gaining any
// other admin power — his app_users row is set to role 'purchasing'.
export function fetchCanSeePurchasing() {
  return fetchRole().then((role) => role === 'admin' || role === 'purchasing')
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
