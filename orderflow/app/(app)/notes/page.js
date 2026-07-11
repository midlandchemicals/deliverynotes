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
  const [summaryByOrder, setSummaryByOrder] = useState({})
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    (async () => {
      // Light columns only — letterhead_snapshot / lines_snapshot can be large
      // (embedded logos), so we fetch those per-note only when opening the PDF.
      const [dnRes, ordRes, prodRes, pkgRes] = await Promise.all([
        supabase.from('dispatch_notes')
          .select('id, doc_no, doc_date, order_id, customer, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('orders').select('id, customer_snapshot, lines'),
        supabase.from('products').select('id, name'),
        supabase.from('packaging').select('id, name'),
      ])
      if (dnRes.error) setErr(dnRes.error.message)
      const liveOrders = new Set((ordRes.data || []).map((o) => o.id))
      setNameByOrder(Object.fromEntries((ordRes.data || []).map((o) => [o.id, o.customer_snapshot?.name || ''])))
      // Order summary per order: "24 × 25L PREMCLEAN · 2 × 1000L MN Super"
      const prodName = Object.fromEntries((prodRes.data || []).map((x) => [x.id, x.name]))
      const pkgName = Object.fromEntries((pkgRes.data || []).map((x) => [x.id, x.name]))
      setSummaryByOrder(Object.fromEntries((ordRes.data || []).map((o) => [
        o.id,
        (o.lines || [])
          .map((l) => {
            const pn = prodName[l.productId]
            if (!pn) return null
            const kn = pkgName[l.packagingId] || ''
            return `${l.qty || ''} × ${kn ? kn + ' ' : ''}${pn}`.trim()
          })
          .filter(Boolean).join(' · '),
      ])))
      // Only show notes whose order still exists (hide notes for deleted orders)
      setNotes((dnRes.data || []).filter((n) => n.order_id && liveOrders.has(n.order_id)))
    })()
  }, [])

  // Fetch the full note (with snapshots) and reopen its PDF
  async function openNote(n) {
    setOpeningId(n.id)
    const { data, error } = await supabase.from('dispatch_notes').select('*').eq('id', n.id).single()
    setOpeningId(null)
    if (error || !data) { alert('Could not open this delivery note: ' + (error?.message || 'not found')); return }
    reprintPDF(data)
  }

  const custName = (n) => nameByOrder[n.order_id] || firstLine(n.customer) || '—'

  const filtered = (notes || []).filter((n) => {
    if (!q) return true
    const hay = `${n.doc_no} ${custName(n)} ${summaryByOrder[n.order_id] || ''}`.toLowerCase()
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

      {err ? (
        <div className="card"><div className="empty" style={{ color: 'var(--bad)' }}>Couldn’t load delivery notes: {err}</div></div>
      ) : notes === null ? (
        <div className="card">{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-row" />)}</div>
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
                onClick={() => openNote(n)}
                title="Reopen this delivery note PDF"
              >
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--heading)' }}>{n.doc_no}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(n)}</span>
                  {summaryByOrder[n.order_id] ? (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summaryByOrder[n.order_id]}>
                      {summaryByOrder[n.order_id]}
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{timeLabel(n.created_at)}</span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  {n.order_id && (
                    <Link href={`/orders/${n.order_id}`} onClick={(e) => e.stopPropagation()} className="btn btn-g btn-sm" style={{ padding: '4px 10px' }}>Order</Link>
                  )}
                  <span className="btn btn-a btn-sm" style={{ padding: '4px 12px' }}>{openingId === n.id ? '…' : '⬇ PDF'}</span>
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
