'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function nameFromEmail(email) {
  if (!email) return ''
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

const ICONS = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" /><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".55" /><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".55" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".55" /></svg>
  ),
  plus: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="6.5" y="1.5" width="2" height="12" rx="1" fill="currentColor" /><rect x="1.5" y="6.5" width="12" height="2" rx="1" fill="currentColor" /></svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="1.5" y="2.5" width="12" height="2" rx="1" fill="currentColor" /><rect x="1.5" y="6.5" width="12" height="2" rx="1" fill="currentColor" /><rect x="1.5" y="10.5" width="8" height="2" rx="1" fill="currentColor" /></svg>
  ),
  box: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="2" y="4" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="5" y="1.5" width="5" height="3" rx="1" fill="currentColor" /></svg>
  ),
  package: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="2" y="2" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="5.5" y="5.5" width="4" height="4" rx="1" fill="currentColor" /></svg>
  ),
  users: (
    <svg width="15" height="15" viewBox="0 0 15 15"><circle cx="5" cy="5" r="2.6" fill="currentColor" /><circle cx="10.5" cy="6" r="2" fill="currentColor" opacity=".55" /><rect x="1.5" y="9" width="9" height="4.5" rx="2.2" fill="currentColor" opacity=".8" /></svg>
  ),
  pound: (
    <svg width="15" height="15" viewBox="0 0 15 15"><circle cx="7.5" cy="7.5" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="6.7" y="4" width="1.6" height="7" rx=".8" fill="currentColor" /><rect x="4.5" y="6" width="6" height="1.6" rx=".8" fill="currentColor" /></svg>
  ),
  doc: (
    <svg width="15" height="15" viewBox="0 0 15 15"><rect x="2.5" y="1.5" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="4.5" y="4" width="6" height="1.5" rx=".75" fill="currentColor" /><rect x="4.5" y="7" width="6" height="1.5" rx=".75" fill="currentColor" opacity=".55" /></svg>
  ),
}

const MAIN_LINKS = [
  ['/', 'Dashboard', 'dashboard'],
  ['/orders/new', 'New Order', 'plus'],
  ['/orders', 'Order Book', 'list'],
  ['/notes', 'Delivery Notes', 'doc'],
]

const CATALOGUE_LINKS = [
  ['/settings/products', 'Products', 'box'],
  ['/settings/packaging', 'Packaging', 'package'],
  ['/settings/customers', 'Customers', 'users'],
  ['/settings/prices', 'Price Entry', 'pound'],
  ['/settings/pricelist', 'Price List', 'pound'],
  ['/settings/dashboard', 'Insights', 'dashboard'],
  ['/settings/letterheads', 'Letterheads', 'doc'],
]

export default function Sidebar({ email, openCount }) {
  const path = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href) => {
    if (href === '/') return path === '/'
    if (href === '/orders/new') return path === '/orders/new'
    if (href === '/orders') return path === '/orders' || (path.startsWith('/orders/') && path !== '/orders/new')
    return path.startsWith(href)
  }

  return (
    <aside className="sidebar">
      <Link href="/" className="logo-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Midland Chemicals" />
      </Link>
      <nav>
        {MAIN_LINKS.map(([href, label, icon]) => (
          <Link key={href} href={href} className={isActive(href) ? 'on' : ''}>
            {ICONS[icon]}
            {label}
            {href === '/orders' && openCount > 0 ? <span className="count">{openCount}</span> : null}
          </Link>
        ))}
        <div className="nav-label">Catalogue</div>
        {CATALOGUE_LINKS.map(([href, label, icon]) => (
          <Link key={href} href={href} className={isActive(href) ? 'on' : ''}>
            {ICONS[icon]}
            {label}
          </Link>
        ))}
      </nav>
      <div className="user-row">
        <div className="avatar">{(nameFromEmail(email) || '?').charAt(0)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="name" title={email}>{nameFromEmail(email)}</div>
          <button className="out" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </aside>
  )
}
