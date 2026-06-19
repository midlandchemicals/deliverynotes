'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function nameFromEmail(email) {
  if (!email) return ''
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

export default function HomePage() {
  const [name, setName] = useState('')
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setName(nameFromEmail(data?.user?.email)))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 100px)', padding: '40px 20px' }}>
      {name && (
        <p style={{ color: 'var(--muted)', fontSize: 17, marginBottom: 8 }}>
          Welcome back, <strong style={{ color: 'var(--ink)' }}>{name}</strong>
        </p>
      )}
      <h1 style={{ fontSize: 30, fontWeight: 800, marginBottom: 40, color: 'var(--ink)', letterSpacing: '-.02em' }}>What would you like to do?</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 260px)', gap: 24, alignItems: 'stretch' }}>
        <HomeCard href="/orders/new" icon="＋" title="New Order" desc="Create a new delivery note" accent />
        <HomeCard href="/orders"     icon="📋" title="Order Book" desc="View and manage all delivery notes" />
        <HomeCard href="/settings/products" icon="⚙" title="Admin" desc="Products, pricing, customers & letterheads" />
      </div>
    </div>
  )
}

function HomeCard({ href, icon, title, desc, accent }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'flex' }}>
      <div style={{
        flex: 1,
        background: accent ? 'var(--accent)' : 'var(--panel)',
        border: accent ? 'none' : '1.5px solid var(--border)',
        borderRadius: 16,
        padding: '44px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 16,
        cursor: 'pointer',
        transition: 'transform 0.12s, box-shadow 0.12s',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.13)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
      >
        <span style={{ fontSize: 44, lineHeight: 1, color: accent ? '#fff' : 'var(--accent)' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 21, color: accent ? '#fff' : 'var(--ink)', marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: accent ? 'rgba(255,255,255,0.82)' : 'var(--muted)', lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
    </Link>
  )
}
