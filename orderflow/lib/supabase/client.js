import { createBrowserClient } from '@supabase/ssr'

// Strip any stray whitespace, line-breaks or quotes that came along when the
// values were pasted — the usual cause of a "fetch: Invalid value" error.
function clean(v) {
  return String(v || '').replace(/\s+/g, '').replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')
}

export function createClient() {
  return createBrowserClient(
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}
