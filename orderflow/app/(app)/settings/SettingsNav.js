'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SUB_LINKS = [
  ['/settings/products', 'Products'],
  ['/settings/packaging', 'Packaging'],
  ['/settings/customers', 'Customers'],
  ['/settings/prices', 'Price Entry'],
  ['/settings/pricelist', 'Price List'],
  ['/settings/letterheads', 'Letterheads'],
]

export default function SettingsNav() {
  const path = usePathname()
  return (
    <div className="sub-nav">
      {SUB_LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? 'on' : ''}>{label}</Link>
      ))}
    </div>
  )
}
