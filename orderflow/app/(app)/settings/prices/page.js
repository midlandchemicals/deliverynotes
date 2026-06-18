'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2000)
}

export default function PricesPage() {
  const supabase = createClient()
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [rows, setRows] = useState([])
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState({ productId: '', packagingId: '', ppl: '', ppp: '' })

  useEffect(() => {
    ;(async () => {
      const [c, p, k] = await Promise.all([
        supabase.from('customers').select('id, name').order('name'),
        supabase.from('products').select('id, name').order('name'),
        supabase.from('packaging').select('id, name, volume').order('volume'),
      ])
      setCustomers(c.data || [])
      setProducts(p.data || [])
      setPackaging(k.data || [])
      if (c.data?.length) setCustomerId(c.data[0].id)
    })()
  }, [])

  useEffect(() => {
    if (customerId) loadPrices(customerId)
  }, [customerId])

  async function loadPrices(cid) {
    const { data } = await supabase.from('customer_product_prices')
      .select('id, product_id, packaging_id, price_per_litre')
      .eq('customer_id', cid)
    setRows(data || [])
  }

  function pkgVol(packagingId) {
    return packaging.find((p) => p.id === packagingId)?.volume || 0
  }

  // When £/L changes: update row, compute new ppp, save
  async function handlePplChange(rowId, val) {
    const ppl = parseFloat(val) || 0
    setRows((r) => r.map((x) => (x.id === rowId ? { ...x, price_per_litre: ppl } : x)))
    await supabase.from('customer_product_prices').update({ price_per_litre: ppl, updated_at: new Date().toISOString() }).eq('id', rowId)
  }

  // When £/pack changes: compute ppl from volume, update row, save
  async function handlePppChange(rowId, packagingId, val) {
    const ppp = parseFloat(val) || 0
    const vol = pkgVol(packagingId)
    const ppl = vol > 0 ? ppp / vol : 0
    setRows((r) => r.map((x) => (x.id === rowId ? { ...x, price_per_litre: ppl } : x)))
    await supabase.from('customer_product_prices').update({ price_per_litre: ppl, updated_at: new Date().toISOString() }).eq('id', rowId)
  }

  async function deleteRow(rowId) {
    setRows((r) => r.filter((x) => x.id !== rowId))
    await supabase.from('customer_product_prices').delete().eq('id', rowId)
  }

  async function addRow() {
    if (!newRow.productId) { toast('Select a product'); return }
    if (!newRow.packagingId) { toast('Select a packaging size'); return }
    const ppl = (() => {
      if (newRow.ppl) return parseFloat(newRow.ppl) || 0
      const vol = pkgVol(newRow.packagingId)
      return vol > 0 ? (parseFloat(newRow.ppp) || 0) / vol : 0
    })()
    const { data, error } = await supabase.from('customer_product_prices')
      .insert({ customer_id: customerId, product_id: newRow.productId, packaging_id: newRow.packagingId, price_per_litre: ppl })
      .select('id, product_id, packaging_id, price_per_litre').single()
    if (error) { toast(error.message); return }
    setRows((r) => [...r, data])
    setAdding(false)
    setNewRow({ productId: '', packagingId: '', ppl: '', ppp: '' })
    toast('Price saved')
  }

  function updateNew(patch) {
    setNewRow((n) => {
      const next = { ...n, ...patch }
      // Keep the two inputs in sync as the user types in the new-row form
      if ('ppl' in patch) {
        const vol = pkgVol(next.packagingId)
        next.ppp = vol > 0 ? ((parseFloat(next.ppl) || 0) * vol).toFixed(4) : ''
      }
      if ('ppp' in patch) {
        const vol = pkgVol(next.packagingId)
        next.ppl = vol > 0 ? ((parseFloat(next.ppp) || 0) / vol).toFixed(6) : ''
      }
      if ('packagingId' in patch) {
        const vol = pkgVol(next.packagingId)
        if (next.ppl) next.ppp = vol > 0 ? ((parseFloat(next.ppl) || 0) * vol).toFixed(4) : ''
        else if (next.ppp) next.ppl = vol > 0 ? ((parseFloat(next.ppp) || 0) / vol).toFixed(6) : ''
      }
      return next
    })
  }

  const selectedCustomer = customers.find((c) => c.id === customerId)

  return (
    <div className="card">
      <div className="ttl">
        <h2>Customer Prices</h2>
        {customerId && <button className="btn btn-a btn-sm" onClick={() => { setAdding(true); setNewRow({ productId: '', packagingId: '', ppl: '', ppp: '' }) }}>＋ Add price</button>}
      </div>

      <div className="filters" style={{ marginBottom: 16 }}>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">— select customer —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {customerId && (
        <>
          <table className="tbl">
            <thead><tr>
              <th>Product</th>
              <th>Packaging</th>
              <th style={{ textAlign: 'right', width: '14%' }}>£ / Litre</th>
              <th style={{ textAlign: 'right', width: '14%' }}>£ / Pack</th>
              <th style={{ width: '4%' }}></th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && !adding && (
                <tr><td colSpan={5} className="empty">No prices set for {selectedCustomer?.name} — click ＋ Add price to begin.</td></tr>
              )}
              {rows.map((row) => {
                const vol = pkgVol(row.packaging_id)
                const ppl = row.price_per_litre || 0
                const ppp = vol > 0 ? ppl * vol : 0
                const prod = products.find((p) => p.id === row.product_id)
                const pkg = packaging.find((p) => p.id === row.packaging_id)
                return (
                  <tr key={row.id}>
                    <td>{prod?.name || <span className="muted">—</span>}</td>
                    <td>{pkg?.name || <span className="muted">—</span>}</td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={ppl || ''}
                        placeholder="0.0000"
                        onChange={(e) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, price_per_litre: e.target.value } : x)))}
                        onBlur={(e) => handlePplChange(row.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={ppp > 0 ? ppp.toFixed(4) : ''}
                        placeholder="0.0000"
                        onChange={(e) => setRows((r) => r.map((x) => {
                          if (x.id !== row.id) return x
                          const newPpl = vol > 0 ? (parseFloat(e.target.value) || 0) / vol : 0
                          return { ...x, price_per_litre: newPpl }
                        }))}
                        onBlur={(e) => handlePppChange(row.id, row.packaging_id, e.target.value)}
                      />
                    </td>
                    <td><button className="btn-dl" onClick={() => deleteRow(row.id)}>×</button></td>
                  </tr>
                )
              })}

              {adding && (
                <tr style={{ background: 'var(--panel-2)' }}>
                  <td>
                    <select value={newRow.productId} onChange={(e) => updateNew({ productId: e.target.value })}>
                      <option value="">— product —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={newRow.packagingId} onChange={(e) => updateNew({ packagingId: e.target.value })}>
                      <option value="">— packaging —</option>
                      {packaging.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="mono" style={{ textAlign: 'right' }}
                      value={newRow.ppl} placeholder="£/L"
                      onChange={(e) => updateNew({ ppl: e.target.value })}
                    />
                  </td>
                  <td>
                    <input className="mono" style={{ textAlign: 'right' }}
                      value={newRow.ppp} placeholder="£/pack"
                      onChange={(e) => updateNew({ ppp: e.target.value })}
                    />
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-a btn-sm" onClick={addRow}>Save</button>
                    <button className="btn btn-g btn-sm" onClick={() => setAdding(false)}>✕</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="hint">Enter either £/litre or £/pack — the other calculates automatically. Prices are looked up by customer, product, and pack size when generating the office copy PDF.</p>
        </>
      )}
    </div>
  )
}
