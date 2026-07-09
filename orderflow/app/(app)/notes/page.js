'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { reprintPDF } from '@/lib/pdf'

function dayLabel(dateStr) {
  if (!dateStr) return 'Undated'
  const d = new Date(String(dateStr).length <= 10 ? dateStr + 'T00:00:00' : dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function timeLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}
function firstLine(t) {
  return String(t || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || ''
}

export default function DeliveryNotesPage() {
  const supabase = createClient()
  const [notes, setNotes] = useState(null)
  const [nameByOrder, setNameByOrder] = useState({})
  const [q, setQ] = useState('')

  useEffect(() => {
    (async () => {
      const [dnRes, ordRes] = await Promise.all([
        supabase.from('dispatch_notes').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('id, customer_snapshot'),
      ])
      setNameByOrder(Object.fromEntries((ordRes.data || []).map((o) => [o.id, o.customer_snapshot?.name || ''])))
      setNotes(dnRes.data || [])
    })()
  }, [])

  const custName = (n) => nameByOrder[n.order_id] || firstLine(n.customer) || '—'

  const filtered = (notes || []).filter((n) => {
    if (!q) return true
    const hay = `${n.doc_no} ${custName(n)}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  // Group by note date (fallback to the created date)
  const groups = []
  const idx = {}
  for (const n of filtered) {
    const key = n.doc_date || (n.created_at ? String(n.created_at).slice(0, 10) : 'Undated')
    if (idx[key] == null) { idx[key] = groups.length; groups.push({ key, items: [] }) }
    groups[idx[key]].items.push(n)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Delivery Notes</h1>
          <div className="sub">Every delivery note you’ve generated — grouped by day. Click one to reopen the PDF.</div>
        </div>
        <Link href="/orders/new" className="btn btn-a">＋ New order</Link>
      </div>

      <div className="card">
        <div className="filters" style={{ marginBottom: 0 }}>
          <input placeholder="Search by DN number or customer…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
          {notes !== null && <span className="muted" style={{ fontSize: 12.5 }}>{filtered.length} note{filtered.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      {notes === null ? (
        <div className="card"><div className="empty">Loading…</div></div>
      ) : groups.length === 0 ? (
        <div className="card"><div className="empty">{q ? `No delivery note matches “${q}”.` : 'No delivery notes generated yet.'}</div></div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="card">
            <div className="ttl" style={{ marginBottom: 10 }}>
              <h2>{dayLabel(g.key)}</h2>
              <span className="muted" style={{ fontSize: 12 }}>{g.items.length} note{g.items.length !== 1 ? 's' : ''}</span>
            </div>
            {g.items.map((n) => (
              <div
                key={n.id}
                className="mini-table-row"
                style={{ gridTemplateColumns: '120px 1fr 150px auto', cursor: 'pointer' }}
                onClick={() => reprintPDF(n)}
                title="Reopen this delivery note PDF"
              >
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--heading)' }}>{n.doc_no}</span>
                <span style={{ fontWeight: 600, color: 'var(--heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(n)}</span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{timeLabel(n.created_at)}</span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  {n.order_id && (
                    <Link href={`/orders/${n.order_id}`} onClick={(e) => e.stopPropagation()} className="btn btn-g btn-sm" style={{ padding: '4px 10px' }}>Order</Link>
                  )}
                  <span className="btn btn-a btn-sm" style={{ padding: '4px 12px' }}>⬇ PDF</span>
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
