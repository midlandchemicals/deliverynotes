'use client'
import Link from 'next/link'

export default function HomePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 72px)', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>OrderFlow</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 48, fontSize: 15 }}>Midland Chemicals — delivery note management</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, width: '100%', maxWidth: 860 }}>
        <HomeCard
          href="/orders/new"
          icon="＋"
          title="New Order"
          desc="Create a new delivery note"
          accent
        />
        <HomeCard
          href="/orders"
          icon="📋"
          title="Order Log"
          desc="View and manage all delivery notes"
        />
        <HomeCard
          href="/settings/products"
          icon="⚙"
          title="Catalogue"
          desc="Products, pricing, customers & letterheads"
        />
      </div>
    </div>
  )
}

function HomeCard({ href, icon, title, desc, accent }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        background: accent ? 'var(--accent)' : 'var(--panel)',
        border: accent ? 'none' : '1.5px solid var(--border)',
        borderRadius: 16,
        padding: '36px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 14,
        cursor: 'pointer',
        transition: 'transform 0.12s, box-shadow 0.12s',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
      >
        <span style={{ fontSize: 40, lineHeight: 1, color: accent ? '#fff' : 'var(--accent)' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: accent ? '#fff' : 'var(--ink)', marginBottom: 6 }}>{title}</div>
          <div style={{ fontSize: 13, color: accent ? 'rgba(255,255,255,0.8)' : 'var(--muted)', lineHeight: 1.4 }}>{desc}</div>
        </div>
      </div>
    </Link>
  )
}
