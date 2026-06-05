import { createBrowserClient } from '@supabase/ssr'

// Trim stray spaces, newlines, quotes or a trailing slash that can sneak into
// pasted env vars — the usual cause of a "fetch: Invalid value" error.
function clean(v) {
  return String(v || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')
}

export function createClient() {
  return createBrowserClient(
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}
