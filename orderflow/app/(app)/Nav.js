'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const LINKS = [
  ['/', 'Orders'],
  ['/orders/new', 'New order'],
  ['/settings/products', 'Products'],
  ['/settings/packaging', 'Packaging'],
  ['/settings/customers', 'Customers'],
  ['/settings/letterheads', 'Letterheads'],
]

export default function Nav({ email }) {
  const path = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href) =>
    href === '/' ? path === '/' || path.startsWith('/orders/') && path !== '/orders/new'
                 : path === href || path.startsWith(href)

  return (
    <div className="topbar">
      <Link href="/" className="brand">Order<b>Flow</b></Link>
      <nav className="nav">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={isActive(href) ? 'on' : ''}>{label}</Link>
        ))}
      </nav>
      <div className="who">
        {email}
        <button className="out" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
