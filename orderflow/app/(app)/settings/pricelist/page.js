'use client'
import { useEffect, useState, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import PricingGuard from '@/app/(app)/PricingGuard'
import { generatePriceListPDF } from '@/lib/pdf'

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2000)
}

// "1–2", "5+", "3" — a quantity band label from a tier
export function bandLabel(t) {
  if (t.to == null) return `${t.from}+`
  if (t.to === t.from) return `${t.from}`
  return `${t.from}–${t.to}`
}

const gridTh = { border: '1px solid var(--border)', padding: '7px 10px', background: 'var(--panel-2)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }
const gridTd = { border: '1px solid var(--border)', padding: '6px 10px', fontSize: 13 }

export default function PriceListPage() {
  const supabase = createClient()
  const [entries, setEntries] = useState(null)
  const [q, setQ] = useState('')
  const [editingId, setEditingId] = useState(null) // customer_product_prices.id being edited
  const [editVal, setEditVal] = useState('')        // draft pack-price string
  const [selected, setSelected] = useState({})       // { [customerId]: true } for export
  const [letterheadsMap, setLetterheadsMap] = useState({}) // { [lhId]: letterhead }
  const [defaultLh, setDefaultLh] = useState({})

  async function load() {
    const [custRes, prodRes, pkgRes, priceRes, lhRes] = await Promise.all([
      supabase.from('customers').select('id, name, default_letterhead_id, three_tier_pricing').order('name'),
      supabase.from('products').select('id, name, category').order('category').order('name'),
      supabase.from('packaging').select('id, name, volume').order('volume'),
      supabase.from('customer_product_prices')
        .select('id, customer_id, product_id, packaging_id, price_per_litre, qty_tiers, tier_basis, price_trade, price_buyer_group, price_retail')
        .gt('price_per_litre', 0),
      supabase.from('letterheads').select('*').order('name'),
    ])

    const lhs = lhRes.data || []
    const midland = lhs.find((l) =>
      (l.name || '').toLowerCase().includes('midland') || (l.company || '').toLowerCase().includes('midland')
    ) || lhs[0] || {}
    setDefaultLh(midland)
    setLetterheadsMap(Object.fromEntries(lhs.map((l) => [l.id, l])))

    const customers = custRes.data || []
    const products  = prodRes.data || []
    const packaging = pkgRes.data || []
    const prices    = priceRes.data || []

    const byCustomer = customers
      .map((c) => {
        const rows = prices
          .filter((p) => p.customer_id === c.id)
          .map((p) => {
            const prod = products.find((x) => x.id === p.product_id)
            const pkg  = packaging.find((x) => x.id === p.packaging_id)
            const vol  = pkg?.volume || 0
            const ppl  = p.price_per_litre || 0
            const ppp  = vol > 0 ? ppl * vol : null
            const tiers = (Array.isArray(p.qty_tiers) ? p.qty_tiers : [])
              .map((t) => {
                const tppl = Number(t.ppl) || 0
                return {
                  from: t.from != null ? Number(t.from) : null,
                  to: t.to != null && t.to !== '' ? Number(t.to) : null,
                  ppl: tppl,
                  ppp: vol > 0 ? tppl * vol : null,
                }
              })
              .filter((t) => t.from != null && t.ppl > 0)
              .sort((a, b) => a.from - b.from)
            // Buyer-level prices (for three_tier customers): { trade, buyer_group, retail } £/L
            const levels = {
              trade: p.price_trade != null ? p.price_trade : ppl,
              buyer_group: p.price_buyer_group != null ? p.price_buyer_group : null,
              retail: p.price_retail != null ? p.price_retail : null,
            }
            return { id: p.id, prod, pkg, vol, ppl, ppp, tiers, basis: p.tier_basis || 'line', levels }
          })
          .filter((r) => r.prod && r.pkg)
          .sort((a, b) => {
            const cc = (a.prod.category || '').localeCompare(b.prod.category || '')
            if (cc !== 0) return cc
            const nc = a.prod.name.localeCompare(b.prod.name)
            if (nc !== 0) return nc
            return (a.pkg.volume || 0) - (b.pkg.volume || 0)
          })
        return { customer: c, rows }
      })
      .filter((e) => e.rows.length > 0)

    setEntries(byCustomer)
    // Note: letterheadsMap may not be set yet when load() runs —
    // we resolve the lh per-entry at export time using the map we built above.
    // Store lhs locally so exportSelected closure can use it:
    // (we expose it via state so the closure stays reactive)
  }

  // Resolve letterhead for a customer entry at export time
  function entryLh(e) {
    return letterheadsMap[e.customer.default_letterhead_id] || defaultLh
  }

  useEffect(() => { load() }, [])

  async function saveEdit(row) {
    const ppp = parseFloat(editVal) || 0
    const ppl = row.vol > 0 ? ppp / row.vol : 0
    if (ppl <= 0) { toast('Enter a price greater than 0'); return }
    const { error } = await supabase.from('customer_product_prices')
      .update({ price_per_litre: ppl, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { toast('Save failed: ' + error.message); return }
    setEditingId(null)
    await load()
    toast('Price updated')
  }

  const filtered = (entries || []).filter((e) =>
    !q || e.customer.name.toLowerCase().includes(q.toLowerCase())
  )

  function toggleSelect(customerId) {
    setSelected((s) => {
      const n = { ...s }
      if (n[customerId]) delete n[customerId]; else n[customerId] = true
      return n
    })
  }

  function toggleSelectAll() {
    if (filtered.every((e) => selected[e.customer.id])) {
      setSelected((s) => {
        const n = { ...s }
        filtered.forEach((e) => delete n[e.customer.id])
        return n
      })
    } else {
      setSelected((s) => {
        const n = { ...s }
        filtered.forEach((e) => { n[e.customer.id] = true })
        return n
      })
    }
  }

  function exportSelected() {
    const chosen = (entries || []).filter((e) => selected[e.customer.id])
    if (!chosen.length) { toast('Select at least one customer to export'); return }
    // Attach the correct letterhead to each entry so each page uses its own branding
    generatePriceListPDF(chosen.map((e) => ({ ...e, lh: entryLh(e) })), defaultLh)
  }

  const selectedCount = Object.keys(selected).length
  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected[e.customer.id])

  return (
    <PricingGuard>
      <div>
        <div className="card">
          <div className="ttl">
            <h2>Price List</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              {entries !== null && `${entries.length} customer${entries.length !== 1 ? 's' : ''} with prices set`}
            </span>
          </div>
          {entries === null ? (
            <div className="empty">Loading…</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <input
                placeholder="Filter by customer name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                Select all
              </label>
              <button
                className="btn btn-a"
                onClick={exportSelected}
                disabled={selectedCount === 0}
                style={{ marginLeft: 'auto', opacity: selectedCount === 0 ? 0.5 : 1 }}
              >
                ⬇ Export to PDF{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
            </div>
          )}
        </div>

        {filtered.map((e) => (
          <div key={e.customer.id} className="card" style={{ marginTop: 12, border: selected[e.customer.id] ? '2px solid var(--accent)' : undefined }}>
            <div className="ttl" style={{ marginBottom: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={!!selected[e.customer.id]}
                  onChange={() => toggleSelect(e.customer.id)}
                  style={{ width: 'auto', height: 17, accentColor: 'var(--accent)' }}
                />
                <h3 style={{ margin: 0 }}>{e.customer.name}</h3>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>EXPORT</span>
              </label>
              <span className="muted" style={{ fontSize: 12 }}>
                {e.customer.three_tier_pricing ? '3 buyer levels · ' : ''}{e.rows.length} product line{e.rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
              <thead>
                {e.customer.three_tier_pricing ? (
                  <tr>
                    <th style={gridTh}>Product</th>
                    <th style={gridTh}>Range</th>
                    <th style={gridTh}>Packaging</th>
                    <th style={{ ...gridTh, textAlign: 'right', width: '15%' }}>Trade £/L</th>
                    <th style={{ ...gridTh, textAlign: 'right', width: '15%' }}>Buyer group £/L</th>
                    <th style={{ ...gridTh, textAlign: 'right', width: '15%' }}>Retail £/L</th>
                  </tr>
                ) : (
                  <tr>
                    <th style={gridTh}>Product</th>
                    <th style={gridTh}>Range</th>
                    <th style={gridTh}>Packaging</th>
                    <th style={{ ...gridTh, textAlign: 'right', width: '14%' }}>£ / Litre</th>
                    <th style={{ ...gridTh, textAlign: 'right', width: '16%' }}>£ / Pack</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {e.rows.map((r, i) => {
                  const isEditing = editingId === r.id
                  const rowBg = i % 2 === 0 ? 'var(--row)' : 'var(--row-alt)'
                  const hasTiers = (r.tiers || []).length > 0
                  const money4 = (v) => (v != null ? `£${Number(v).toFixed(4)}` : '—')
                  if (e.customer.three_tier_pricing) {
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={gridTd}>{r.prod.name}</td>
                        <td style={{ ...gridTd, color: 'var(--muted)' }}>{r.prod.category || '—'}</td>
                        <td style={gridTd}>{r.pkg.name}</td>
                        <td style={{ ...gridTd, textAlign: 'right', fontFamily: 'monospace' }}>{money4(r.levels.trade)}</td>
                        <td style={{ ...gridTd, textAlign: 'right', fontFamily: 'monospace' }}>{money4(r.levels.buyer_group)}</td>
                        <td style={{ ...gridTd, textAlign: 'right', fontFamily: 'monospace' }}>{money4(r.levels.retail)}</td>
                      </tr>
                    )
                  }
                  return (
                    <Fragment key={r.id}>
                    <tr style={{ background: rowBg }}>
                      <td style={gridTd}>{r.prod.name}</td>
                      <td style={{ ...gridTd, color: 'var(--muted)' }}>{r.prod.category || '—'}</td>
                      <td style={gridTd}>{r.pkg.name}</td>
                      <td style={{ ...gridTd, textAlign: 'right', fontFamily: 'monospace' }}>
                        £{r.ppl.toFixed(4)}
                      </td>
                      <td style={{ ...gridTd, textAlign: 'right' }}>
                        {isEditing ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>£</span>
                            <input
                              autoFocus
                              className="mono"
                              style={{ width: 80, textAlign: 'right', padding: '3px 6px' }}
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(r)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                            />
                            <button className="btn btn-a btn-sm" style={{ padding: '3px 8px' }} onClick={() => saveEdit(r)}>✓</button>
                            <button className="btn btn-g btn-sm" style={{ padding: '3px 8px' }} onClick={() => setEditingId(null)}>✕</button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <span style={{ fontFamily: 'monospace' }}>
                              {r.ppp !== null ? `£${r.ppp.toFixed(2)}` : '—'}
                            </span>
                            <button
                              title="Edit price"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '1px 3px', lineHeight: 1 }}
                              onClick={() => { setEditingId(r.id); setEditVal(r.ppp !== null ? r.ppp.toFixed(2) : '') }}
                            >✏️</button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {hasTiers && (
                      <tr style={{ background: rowBg }}>
                        <td style={{ ...gridTd, borderTop: 'none', paddingTop: 0, paddingBottom: 9 }} colSpan={5}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)' }}>
                              {r.basis === 'order' ? 'Qty breaks (combined order)' : 'Qty breaks'}
                            </span>
                            {r.tiers.map((t, ti) => (
                              <span key={ti} style={{
                                fontSize: 12, background: 'rgba(31,168,107,0.12)', border: '1px solid rgba(31,168,107,0.35)',
                                borderRadius: 6, padding: '2px 8px', fontFamily: 'monospace', color: 'var(--ink)',
                              }}>
                                <b>{bandLabel(t)} {r.basis === 'order' ? 'combined' : r.pkg.name}</b>: £{t.ppl.toFixed(4)}/L{t.ppp != null ? ` · £${t.ppp.toFixed(2)}/pack` : ''}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

        {entries !== null && filtered.length === 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="empty">{q ? `No customers match "${q}"` : 'No customers with prices set yet.'}</div>
          </div>
        )}
      </div>
    </PricingGuard>
  )
}
