'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import PricingGuard from '@/app/(app)/PricingGuard'

export default function PriceListPage() {
  const supabase = createClient()
  const [entries, setEntries] = useState(null) // null = loading
  const [q, setQ] = useState('')

  useEffect(() => {
    ;(async () => {
      const [custRes, prodRes, pkgRes, priceRes] = await Promise.all([
        supabase.from('customers').select('id, name').order('name'),
        supabase.from('products').select('id, name, category').order('category').order('name'),
        supabase.from('packaging').select('id, name, volume').order('volume'),
        supabase.from('customer_product_prices')
          .select('customer_id, product_id, packaging_id, price_per_litre, delivery_charge')
          .gt('price_per_litre', 0),
      ])

      const customers = custRes.data || []
      const products  = prodRes.data || []
      const packaging = pkgRes.data || []
      const prices    = priceRes.data || []

      // Group prices by customer, skip customers with no priced rows
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
              return { prod, pkg, ppl, ppp, dc: p.delivery_charge || 0 }
            })
            .filter((r) => r.prod && r.pkg)
            .sort((a, b) => {
              const catCmp = (a.prod.category || '').localeCompare(b.prod.category || '')
              if (catCmp !== 0) return catCmp
              const nameCmp = a.prod.name.localeCompare(b.prod.name)
              if (nameCmp !== 0) return nameCmp
              return (a.pkg.volume || 0) - (b.pkg.volume || 0)
            })
          return { customer: c, rows }
        })
        .filter((e) => e.rows.length > 0)

      setEntries(byCustomer)
    })()
  }, [])

  const filtered = (entries || []).filter((e) => {
    if (!q) return true
    const hay = e.customer.name.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  return (
    <PricingGuard>
      <div>
        <div className="card">
          <div className="ttl">
            <h2>Price List</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              {entries === null ? '' : `${entries.length} customer${entries.length !== 1 ? 's' : ''} with prices set`}
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
            <table className="tbl" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Range</th>
                  <th>Packaging</th>
                  <th style={{ textAlign: 'right', width: '12%' }}>£ / Litre</th>
                  <th style={{ textAlign: 'right', width: '12%' }}>£ / Pack</th>
                  <th style={{ textAlign: 'right', width: '12%' }}>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.prod.name}</td>
                    <td><span className="muted">{r.prod.category || '—'}</span></td>
                    <td>{r.pkg.name}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>£{r.ppl.toFixed(4)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {r.ppp !== null ? `£${r.ppp.toFixed(2)}` : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {r.dc > 0 ? `£${r.dc.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
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
