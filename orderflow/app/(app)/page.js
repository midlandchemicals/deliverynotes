'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'

function nameFromEmail(email) {
  if (!email) return ''
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage() {
  const supabase = createClient()
  const router = useRouter()
  const [name, setName] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    (async () => {
      const [{ data: { user } }, ordRes, prodRes] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('id,name'),
      ])
      setName(nameFromEmail(user?.email))
      const orders = ordRes.data || []
      const products = prodRes.data || []
      const nameOf = (id) => (products.find((p) => p.id === id) || {}).name || ''

      const now = new Date()
      const weekAhead = new Date(now.getTime() + 7 * 86400000)
      const counts = { 'New': 0, 'In progress': 0, 'Delivery Note Generated': 0 }
      let dueThisWeek = 0
      let earliestDue = null
      let dispatchedThisMonth = 0
      for (const o of orders) {
        counts[o.status] = (counts[o.status] || 0) + 1
        if (o.status !== 'Delivery Note Generated' && o.requested_date) {
          const d = new Date(o.requested_date)
          if (d >= now && d <= weekAhead) {
            dueThisWeek++
            if (!earliestDue || d < earliestDue) earliestDue = d
          }
        }
        if (o.status === 'Delivery Note Generated') {
          const d = new Date(o.order_date || o.created_at)
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) dispatchedThisMonth++
        }
      }
      const recent = orders.slice(0, 5).map((o) => ({
        ...o,
        productSummary: (o.lines || []).map((l) => nameOf(l.productId)).filter(Boolean).slice(0, 2).join(' · '),
      }))
      setData({ counts, dueThisWeek, earliestDue, dispatchedThisMonth, total: orders.length, recent })
    })()
  }, [])

  if (!data) return <div className="card"><div className="empty">Loading…</div></div>

  const open = (data.counts['New'] || 0) + (data.counts['In progress'] || 0)
  const maxStatus = Math.max(1, data.counts['New'], data.counts['In progress'], data.counts['Delivery Note Generated'])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {greeting()}{name ? `, ${name}` : ''}{open > 0 ? ` — ${open} order${open === 1 ? ' is' : 's are'} open.` : ' — all orders are dispatched.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/orders" className="btn btn-g">Order Book</Link>
          <Link href="/orders/new" className="btn btn-a">＋ New Order</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="k-label">Open orders</div>
          <div className="k-value k-green">{open}</div>
          <div className="k-sub">{data.counts['New'] || 0} new · {data.counts['In progress'] || 0} in progress</div>
        </div>
        <div className="kpi">
          <div className="k-label">Due this week</div>
          <div className="k-value k-amber">{data.dueThisWeek}</div>
          <div className="k-sub">{data.earliestDue ? `earliest: ${prettyDate(data.earliestDue.toISOString().slice(0, 10))}` : 'no requested dates'}</div>
        </div>
        <div className="kpi">
          <div className="k-label">Dispatched this month</div>
          <div className="k-value k-blue">{data.dispatchedThisMonth}</div>
          <div className="k-sub">delivery notes generated</div>
        </div>
        <div className="kpi">
          <div className="k-label">Orders on the book</div>
          <div className="k-value">{data.total}</div>
          <div className="k-sub">all time</div>
        </div>
      </div>

      <div className="home-grid">
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 8 }}>
            <h2>Recent orders</h2>
            <Link href="/orders" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>View all →</Link>
          </div>
          {data.recent.length === 0 ? (
            <div className="empty">No orders yet — log one from <b>New Order</b>.</div>
          ) : (
            <>
              <div className="mini-table-head">
                <div>DN No.</div><div>Customer</div><div>Ordered</div><div style={{ textAlign: 'right' }}>Status</div>
              </div>
              {data.recent.map((o) => (
                <div key={o.id} className="mini-table-row" onClick={() => router.push(`/orders/${o.id}`)}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--heading)' }}>{o.order_no}</div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--heading)', fontSize: 13.5 }}>{o.customer_snapshot?.name || '—'}</div>
                    {o.productSummary ? <div style={{ fontSize: 12, color: 'var(--faint)' }}>{o.productSummary}</div> : null}
                  </div>
                  <div style={{ fontSize: 13 }}>{prettyDate(o.order_date)}</div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={'status st-' + String(o.status || 'New').replace(/\s+/g, '')}>
                      {o.status === 'Delivery Note Generated' ? 'Dispatched' : o.status}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="ttl" style={{ marginBottom: 14 }}><h2>Orders by status</h2></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <StatusBar label="New" value={data.counts['New'] || 0} max={maxStatus} color="#3565A8" />
              <StatusBar label="In progress" value={data.counts['In progress'] || 0} max={maxStatus} color="var(--gold)" />
              <StatusBar label="Dispatched" value={data.counts['Delivery Note Generated'] || 0} max={maxStatus} color="var(--accent)" />
            </div>
          </div>
          <div className="card" style={{ margin: 0 }}>
            <div className="ttl" style={{ marginBottom: 12 }}><h2>Quick actions</h2></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="quick-action" onClick={() => router.push('/orders/new')}>＋ Log a new order</button>
              <button className="quick-action" onClick={() => router.push('/settings/prices')}>£ Enter customer prices</button>
              <button className="quick-action" onClick={() => router.push('/settings/customers')}>⌂ Add a customer</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBar({ label, value, max, color }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        <span style={{ color: 'var(--muted)' }}>{value}</span>
      </div>
      <div className="status-bar-track">
        <div className="status-bar" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
    </div>
  )
}
