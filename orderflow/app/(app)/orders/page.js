'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'
import { ok } from '@/lib/notify'

const STATUSES = ['All', 'New', 'In progress', 'Delivery Note Generated']

function nameFromEmail(email) {
  if (!email) return null
  const local = email.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function enteredBy(o) {
  const name = nameFromEmail(o.added_by)
  if (!name && !o.created_at) return null
  const dt = new Date(o.created_at)
  const time = dt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  const date = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `Entered${name ? ` by ${name}` : ''} at ${time} on ${date}`
}

export default function OrdersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [orders, setOrders] = useState(null)
  const [products, setProducts] = useState([])
  const [letterheads, setLetterheads] = useState([])
  const [custLhMap, setCustLhMap] = useState({})   // { customerId: letterheadId }
  const [filter, setFilter] = useState('All')
  const [q, setQ] = useState('')
  const [lhTab, setLhTab] = useState(undefined)    // undefined = not yet chosen; null = default company
  const [olderMonths, setOlderMonths] = useState([]) // [{key:'2026-03', label:'March 2026', count}]
  const [loadedMonths, setLoadedMonths] = useState({}) // key -> true once fetched
  const [loadingMonth, setLoadingMonth] = useState(null)

  useEffect(() => {
    (async () => {
      // Only the last 3 months load up front — older months appear as buttons
      // and fetch on click, so the page stays fast as history grows.
      const cd = new Date(); cd.setMonth(cd.getMonth() - 3)
      const cutoff = cd.toISOString()
      const [o, older, p, c, lh] = await Promise.all([
        supabase.from('orders').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }),
        supabase.from('orders').select('created_at').lt('created_at', cutoff).order('created_at', { ascending: false }),
        supabase.from('products').select('id,name'),
        supabase.from('customers').select('id, default_letterhead_id'),
        supabase.from('letterheads').select('id, name, company, color').order('name'),
      ])
      setProducts(p.data || [])
      setLetterheads(lh.data || [])
      const map = {}
      for (const cust of (c.data || [])) {
        if (cust.default_letterhead_id) map[cust.id] = cust.default_letterhead_id
      }
      setCustLhMap(map)
      setOrders(o.data || [])
      // Bucket older orders into months (dates-only query — tiny payload)
      const buckets = {}
      for (const row of (older.data || [])) {
        const d = new Date(row.created_at)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        buckets[key] = (buckets[key] || 0) + 1
      }
      setOlderMonths(Object.entries(buckets).map(([key, count]) => {
        const [y, m] = key.split('-')
        const label = new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
        return { key, label, count }
      }))
    })()
  }, [])

  async function loadMonth(mKey) {
    if (loadedMonths[mKey] || loadingMonth) return
    setLoadingMonth(mKey)
    const [y, m] = mKey.split('-').map(Number)
    const from = new Date(y, m - 1, 1).toISOString()
    const to = new Date(y, m, 1).toISOString()
    const { data } = await supabase.from('orders').select('*')
      .gte('created_at', from).lt('created_at', to)
      .order('created_at', { ascending: false })
    setOrders((cur) => {
      const have = new Set(cur.map((x) => x.id))
      return [...cur, ...(data || []).filter((x) => !have.has(x.id))]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    })
    setLoadedMonths((lm) => ({ ...lm, [mKey]: true }))
    setLoadingMonth(null)
  }

  async function remove(e, order) {
    e.stopPropagation()
    if (!confirm(`Delete delivery note ${order.order_no}? This cannot be undone.`)) return
    // Remove any generated delivery notes for this order too, so they don't
    // linger in the Delivery Notes library after the order is gone.
    if (!ok(await supabase.from('dispatch_notes').delete().eq('order_id', order.id), 'deleting its delivery notes')) return
    if (!ok(await supabase.from('orders').delete().eq('id', order.id), 'deleting the order')) return
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

  // Which letterhead does this order's customer default to? null = Midland/default
  function orderLhId(o) {
    return (o.customer_id && custLhMap[o.customer_id]) || null
  }

  // The "main" letterhead (Midland or first in list)
  const defaultLh = letterheads.find((l) =>
    l.name.toLowerCase().includes('midland') || l.company.toLowerCase().includes('midland')
  ) || letterheads[0]

  // Letterheads that have at least one order AND are not the default
  const extraLhs = letterheads.filter((lh) =>
    lh.id !== defaultLh?.id && orders.some((o) => orderLhId(o) === lh.id)
  )
  const showTabs = extraLhs.length > 0

  // Resolve active tab (null = default company)
  const activeTab = lhTab === undefined ? null : lhTab

  // Orders for the current tab
  const tabOrders = showTabs
    ? orders.filter((o) => orderLhId(o) === activeTab)
    : orders

  const filtered = tabOrders.filter((o) => {
    if (filter !== 'All' && o.status !== filter) return false
    if (q) {
      const hay = `${o.order_no} ${o.po_ref} ${o.customer_snapshot?.name || ''} ${productSummary(o)}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  // Colour for the active tab's accent
  const activeTabLh = letterheads.find((l) => l.id === activeTab) || defaultLh

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>Order Book</h2>
          <Link href="/orders/new" className="btn btn-a btn-sm">＋ New order</Link>
        </div>

        {/* Company tabs — only rendered when there are multiple companies */}
        {showTabs && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {/* Default / Midland tab */}
            {(() => {
              const color = defaultLh?.color || 'var(--accent)'
              const isActive = activeTab === null
              return (
                <button key="default" onClick={() => setLhTab(null)} style={{
                  padding: '8px 22px', borderRadius: 50, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', border: `2px solid ${color}`,
                  background: isActive ? color : 'transparent',
                  color: isActive ? '#fff' : color,
                  transition: 'all 0.15s',
                }}>
                  {defaultLh?.company || 'Midland Chemicals'}
                </button>
              )
            })()}
            {/* Extra letterhead tabs */}
            {extraLhs.map((lh) => {
              const isActive = activeTab === lh.id
              const color = lh.color || '#555'
              return (
                <button key={lh.id} onClick={() => setLhTab(lh.id)} style={{
                  padding: '8px 22px', borderRadius: 50, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', border: `2px solid ${color}`,
                  background: isActive ? color : 'transparent',
                  color: isActive ? '#fff' : color,
                  transition: 'all 0.15s',
                }}>
                  {lh.company || lh.name}
                </button>
              )
            })}
          </div>
        )}

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
                  {enteredBy(o) ? <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>· {enteredBy(o)}</span> : null}
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

        {/* Older history — loads on demand so the page opens fast */}
        {olderMonths.filter((m) => !loadedMonths[m.key]).length > 0 && (
          <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 10 }}>
              Older orders — click a month to load it
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {olderMonths.filter((m) => !loadedMonths[m.key]).map((m) => (
                <button key={m.key} className="btn btn-g btn-sm" onClick={() => loadMonth(m.key)} disabled={loadingMonth === m.key}>
                  {loadingMonth === m.key ? 'Loading…' : `${m.label} (${m.count})`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function StatusBadge({ status }) {
  const cls = 'st-' + String(status || 'New').replace(/\s+/g, '')
  return <span className={`status ${cls}`}>{status}</span>
}
