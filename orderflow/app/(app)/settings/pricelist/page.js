'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import PricingGuard from '@/app/(app)/PricingGuard'

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2000)
}

const gridTh = { border: '1px solid var(--border)', padding: '7px 10px', background: 'var(--panel-2)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }
const gridTd = { border: '1px solid var(--border)', padding: '6px 10px', fontSize: 13 }

export default function PriceListPage() {
  const supabase = createClient()
  const [entries, setEntries] = useState(null)
  const [q, setQ] = useState('')
  const [editingId, setEditingId] = useState(null) // customer_product_prices.id being edited
  const [editVal, setEditVal] = useState('')        // draft pack-price string

  async function load() {
    const [custRes, prodRes, pkgRes, priceRes] = await Promise.all([
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('products').select('id, name, category').order('category').order('name'),
      supabase.from('packaging').select('id, name, volume').order('volume'),
      supabase.from('customer_product_prices')
        .select('id, customer_id, product_id, packaging_id, price_per_litre')
        .gt('price_per_litre', 0),
    ])

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
            return { id: p.id, prod, pkg, vol, ppl, ppp }
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
            <div className="filters" style={{ marginBottom: 0 }}>
              <input
                placeholder="Filter by customer name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            </div>
          )}
        </div>

        {filtered.map((e) => (
          <div key={e.customer.id} className="card" style={{ marginTop: 12 }}>
            <div className="ttl" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{e.customer.name}</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                {e.rows.length} product line{e.rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
              <thead>
                <tr>
                  <th style={gridTh}>Product</th>
                  <th style={gridTh}>Range</th>
                  <th style={gridTh}>Packaging</th>
                  <th style={{ ...gridTh, textAlign: 'right', width: '14%' }}>£ / Litre</th>
                  <th style={{ ...gridTh, textAlign: 'right', width: '16%' }}>£ / Pack</th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r, i) => {
                  const isEditing = editingId === r.id
                  const rowBg = i % 2 === 0 ? '#fff' : 'rgba(31,168,107,0.06)'
                  return (
                    <tr key={r.id} style={{ background: rowBg }}>
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
