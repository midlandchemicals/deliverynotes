'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import FactOfTheDay from './FactOfTheDay'

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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px 60px' }}>
      <p style={{ fontSize: 34, fontWeight: 700, margin: '0 0 18px', color: 'var(--heading)', letterSpacing: '-.02em', textAlign: 'center', fontFamily: 'var(--font-display)', minHeight: 42 }}>
        Welcome back{name ? <>, <span style={{ color: 'var(--accent)' }}>{name}</span></> : ''}
      </p>

      <div style={{ width: '100%', marginBottom: 30 }}>
        <FactOfTheDay />
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 22, color: 'var(--ink)', letterSpacing: '-.01em', textAlign: 'center' }}>What would you like to do?</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 260px)', gap: 24, alignItems: 'stretch' }}>
        <HomeCard href="/orders/new" icon="＋" title="New Order" desc="Create a new delivery note" accent />
        <HomeCard href="/orders"     icon="📋" title="Order Book" desc="View and manage all delivery notes" />
        <HomeCard href="/settings/dashboard" icon="⚙" title="Admin" desc="Products, pricing, customers & letterheads" />
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
        <span style={{ fontSize: 44, lineHeight: 1, color: accent ? 'var(--on-accent)' : 'var(--accent)' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 21, color: accent ? 'var(--on-accent)' : 'var(--ink)', marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: accent ? 'var(--on-accent)' : 'var(--muted)', opacity: accent ? 0.85 : 1, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
    </Link>
  )
}
