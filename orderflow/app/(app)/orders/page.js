'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'

const STATUSES = ['All', 'New', 'In progress', 'Delivery Note Generated']

export default function OrdersPage() {
  const supabase = createClient()
  const router = useRouter()
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

  async function remove(e, order) {
    e.stopPropagation()
    if (!confirm(`Delete delivery note ${order.order_no}? This cannot be undone.`)) return
    await supabase.from('orders').delete().eq('id', order.id)
    setOrders((list) => list.filter((x) => x.id !== order.id))
  }

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
          <h2>Delivery Note Log</h2>
          <Link href="/orders/new" className="btn btn-a btn-sm">＋ New order</Link>
        </div>

        <div className="filters">
          <input placeholder="Search DN no., customer order no., customer or product…" value={q} onChange={(e) => setQ(e.target.value)} />
          {STATUSES.map((s) => (
            <span key={s} className={'chip' + (filter === s ? ' on' : '')} onClick={() => setFilter(s)}>{s}</span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No delivery notes match. Log one from <b>New delivery note</b>.</div>
        ) : (
          filtered.map((o) => (
            <div key={o.id} className={'list-row st-border-' + String(o.status || 'New').replace(/\s+/g, '')} onClick={() => router.push(`/orders/${o.id}`)} style={{ cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span className="list-customer">{o.customer_snapshot?.name || '—'}</span>
                  <span className="list-orderno">{o.order_no}{o.po_ref ? ` · Order: ${o.po_ref}` : ''}</span>
                </div>
                <div className="list-date">
                  {prettyDate(o.order_date)}
                  {o.requested_date ? ` · required ${prettyDate(o.requested_date)}` : ''}
                </div>
                {(o.lines || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                    {(o.lines || []).map((l, i) => {
                      const name = nameOf(l.productId)
                      return name ? <span key={i} className="prod-tag">{name}</span> : null
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
                <StatusBadge status={o.status} />
                <button className="btn-dl" onClick={(e) => remove(e, o)} title="Delete">×</button>
              </div>
            </div>
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
