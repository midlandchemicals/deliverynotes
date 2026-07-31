'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, normalizeStatus, STATUS_NEW, STATUS_BOARD, STATUS_DONE } from '@/lib/calc'

function nameFromEmail(email) {
  if (!email) return ''
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

// "just now" / "3 hrs ago" — only ever shown for the last-24-hour orders.
function sinceLabel(ts) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} mins ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
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
      const counts = { [STATUS_NEW]: 0, [STATUS_BOARD]: 0, [STATUS_DONE]: 0 }
      let dueThisWeek = 0
      let earliestDue = null
      let dispatchedThisMonth = 0
      for (const o of orders) {
        const st = normalizeStatus(o.status)
        counts[st] = (counts[st] || 0) + 1
        if (st !== STATUS_DONE && o.requested_date) {
          const d = new Date(o.requested_date)
          if (d >= now && d <= weekAhead) {
            dueThisWeek++
            if (!earliestDue || d < earliestDue) earliestDue = d
          }
        }
        if (st === STATUS_DONE) {
          const d = new Date(o.order_date || o.created_at)
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) dispatchedThisMonth++
        }
      }
      // Everything, newest first — the list scrolls rather than being cut to 5.
      const dayAgo = now.getTime() - 86400000
      const all = orders.map((o) => ({
        ...o,
        productSummary: (o.lines || []).map((l) => nameOf(l.productId)).filter(Boolean).slice(0, 2).join(' · '),
        isNew24: !!o.created_at && new Date(o.created_at).getTime() >= dayAgo,
        enteredByName: nameFromEmail(o.added_by),
      }))
      const new24 = all.filter((o) => o.isNew24).length
      setData({ counts, dueThisWeek, earliestDue, dispatchedThisMonth, total: orders.length, all, new24 })
    })()
  }, [])

  if (!data) return (
    <div>
      <div className="skel skel-title" />
      <div className="kpi-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}</div>
      <div className="card" style={{ marginTop: 14 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-row" />)}
      </div>
    </div>
  )

  const open = (data.counts[STATUS_NEW] || 0) + (data.counts[STATUS_BOARD] || 0)
  const maxStatus = Math.max(1, data.counts[STATUS_NEW], data.counts[STATUS_BOARD], data.counts[STATUS_DONE])

  return (
    <div>
      <div className="page-head" style={{ marginTop: 48 }}>
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {greeting()}{name ? `, ${name}` : ''}{open > 0 ? ` — ${open} order${open === 1 ? ' is' : 's are'} open.` : ' — all orders are dispatched.'}
            {data.new24 > 0 ? ` ${data.new24} came in over the last 24 hours.` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/orders" className="btn btn-g">Order Book</Link>
          <Link href="/orders/new" className="btn btn-a">＋ New Order</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi kpi-link" onClick={() => router.push('/orders?filter=open')} title="View open orders">
          <div className="k-label">Open orders</div>
          <div className="k-value k-green">{open}</div>
          <div className="k-sub">awaiting a delivery note →</div>
        </div>
        <div className="kpi kpi-link" onClick={() => router.push('/orders?due=week')} title="View orders due this week">
          <div className="k-label">Due this week</div>
          <div className="k-value k-amber">{data.dueThisWeek}</div>
          <div className="k-sub">{data.earliestDue ? `earliest: ${prettyDate(data.earliestDue.toISOString().slice(0, 10))} →` : 'no requested dates →'}</div>
        </div>
        <div className="kpi kpi-link" onClick={() => router.push('/orders?filter=done')} title="View completed orders">
          <div className="k-label">Dispatched this month</div>
          <div className="k-value k-blue">{data.dispatchedThisMonth}</div>
          <div className="k-sub">delivery notes created →</div>
        </div>
        <div className="kpi kpi-link" onClick={() => router.push('/orders')} title="View the order book">
          <div className="k-label">Orders on the book</div>
          <div className="k-value">{data.total}</div>
          <div className="k-sub">all time →</div>
        </div>
      </div>

      <div className="home-grid">
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 8 }}>
            <h2>
              All orders <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>({data.all.length})</span>
              {data.new24 > 0 && (
                <span style={{ marginLeft: 8, background: 'var(--badge-new-bg)', color: 'var(--badge-new-fg)', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 10px' }}>
                  {data.new24} in the last 24 hrs
                </span>
              )}
            </h2>
            <Link href="/orders" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Order Book →</Link>
          </div>
          {data.all.length === 0 ? (
            <div className="empty">No orders yet — log one from <b>New Order</b>.</div>
          ) : (
            <div className="order-scroll">
              <div className="mini-table-head">
                <div>DN No.</div><div>Customer</div><div>Ordered</div><div style={{ textAlign: 'right' }}>Status</div>
              </div>
              {data.all.map((o) => (
                <div key={o.id} className={'mini-table-row' + (o.isNew24 ? ' row-new24' : '')} onClick={() => router.push(`/orders/${o.id}`)}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--heading)' }}>
                    {o.order_no}
                    {o.isNew24 && (
                      <>
                        <div className="new24-tag">🆕 {sinceLabel(o.created_at)}</div>
                        {o.enteredByName && <div className="new24-by">by {o.enteredByName}</div>}
                      </>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--heading)', fontSize: 13.5 }}>{o.customer_snapshot?.name || '—'}</div>
                    {o.productSummary ? <div style={{ fontSize: 12, color: 'var(--faint)' }}>{o.productSummary}</div> : null}
                  </div>
                  <div style={{ fontSize: 13 }}>{prettyDate(o.order_date)}</div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={'status st-' + normalizeStatus(o.status).replace(/\s+/g, '')}>
                      {normalizeStatus(o.status) === STATUS_DONE ? 'Note printed' : normalizeStatus(o.status) === STATUS_BOARD ? 'On board' : 'New'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="ttl" style={{ marginBottom: 14 }}><h2>Orders by status</h2></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <StatusBar label="New order" value={data.counts[STATUS_NEW] || 0} max={maxStatus} color="#3565A8" />
              <StatusBar label="On board" value={data.counts[STATUS_BOARD] || 0} max={maxStatus} color="var(--gold)" />
              <StatusBar label="Delivery note printed" value={data.counts[STATUS_DONE] || 0} max={maxStatus} color="var(--accent)" />
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
