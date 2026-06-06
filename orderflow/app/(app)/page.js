'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'

const STATUSES = ['All', 'New', 'In progress', 'Dispatched', 'Invoiced']

export default function OrdersPage() {
  const supabase = createClient()
  const [orders, setOrders] = useState(null)
  const [products, setProducts] = useState([])
  const [filter, setFilter] = useState('All')
  const [q, setQ] = useState('')

  useEffect(() => {
    (async () => {
      const [o, p] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('id,name'),
      ])
      setProducts(p.data || [])
      setOrders(o.data || [])
    })()
  }, [])

  if (orders === null) return <div className="card"><div className="empty">Loading orders…</div></div>

  const nameOf = (id) => (products.find((p) => p.id === id) || {}).name || ''
  const productSummary = (o) => {
    const names = (o.lines || []).map((l) => nameOf(l.productId)).filter(Boolean)
    if (!names.length) return ''
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
  }

  const filtered = orders.filter((o) => {
    if (filter !== 'All' && o.status !== filter) return false
    if (q) {
      const hay = `${o.order_no} ${o.po_ref} ${o.customer_snapshot?.name || ''} ${productSummary(o)}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>Order Log</h2>
          <Link href="/orders/new" className="btn btn-a btn-sm">＋ New order</Link>
        </div>

        <div className="filters">
          <input placeholder="Search order no, PO, customer or product…" value={q} onChange={(e) => setQ(e.target.value)} />
          {STATUSES.map((s) => (
            <span key={s} className={'chip' + (filter === s ? ' on' : '')} onClick={() => setFilter(s)}>{s}</span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No orders match. Log one from <b>New order</b>.</div>
        ) : (
          filtered.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`}>
              <div className="list-row">
                <div>
                  <div className="ono">{o.order_no} <StatusBadge status={o.status} /></div>
                  {productSummary(o) ? (
                    <div style={{ color: 'var(--accent)', fontSize: 13.5, fontWeight: 600, margin: '3px 0' }}>
                      {productSummary(o)}
                    </div>
                  ) : null}
                  <div className="meta">
                    {o.customer_snapshot?.name || '—'}
                    {o.po_ref ? ` · PO ${o.po_ref}` : ''} · ordered {prettyDate(o.order_date)}
                    {o.requested_date ? ` · wanted ${prettyDate(o.requested_date)}` : ''}
                    {` · ${(o.lines || []).length} line(s)`}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 18 }}>›</div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

export function StatusBadge({ status }) {
  const cls = 'st-' + String(status || 'New').replace(/\s+/g, '')
  return <span className={`status ${cls}`}>{status}</span>
}
