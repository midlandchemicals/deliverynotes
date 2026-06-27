'use client'
import { useEffect, useState, useMemo, useRef, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import PricingGuard from '@/app/(app)/PricingGuard'
import Combobox from '@/app/(app)/Combobox'

// Loose match between a product's range/category and a customer name, so a
// customer called "CIS Industrial Services" matches products whose range is
// just "CIS". Matches on substring either way, or on shared word tokens.
function matchesCustomer(category, customerName) {
  const cat = String(category || '').toLowerCase().trim()
  const cust = String(customerName || '').toLowerCase().trim()
  if (!cat || !cust) return false
  if (cust.includes(cat) || cat.includes(cust)) return true
  const custTokens = cust.split(/[^a-z0-9]+/).filter((t) => t.length >= 2)
  const catTokens = cat.split(/[^a-z0-9]+/).filter((t) => t.length >= 2)
  return catTokens.some((ct) => custTokens.includes(ct))
}

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
  const [newRow, setNewRow] = useState({ productId: '', packagingId: '', ppl: '', ppp: '', dc: '' })
  const [drafts, setDrafts] = useState([]) // bulk-fill rows awaiting prices
  const dupSeq = useRef(0)                  // counter for unique duplicate-draft keys
  const [tiersRowId, setTiersRowId] = useState(null) // saved-row id whose qty tiers are open

  useEffect(() => {
    ;(async () => {
      const [c, p, k] = await Promise.all([
        supabase.from('customers').select('id, name').order('name'),
        supabase.from('products').select('id, name, category').order('category').order('name'),
        supabase.from('packaging').select('id, name, volume').order('volume'),
      ])
      setCustomers(c.data || [])
      setProducts(p.data || [])
      setPackaging(k.data || [])
      if (c.data?.length) setCustomerId(c.data[0].id)
    })()
  }, [])

  useEffect(() => {
    setDrafts([])
    if (customerId) loadPrices(customerId)
  }, [customerId])

  async function loadPrices(cid) {
    const { data } = await supabase.from('customer_product_prices')
      .select('id, product_id, packaging_id, price_per_litre, delivery_charge, qty_tiers')
      .eq('customer_id', cid)
    setRows((data || []).map((r) => ({ ...r, qty_tiers: Array.isArray(r.qty_tiers) ? r.qty_tiers : [] })))
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

  async function handleDeliveryChange(rowId, val) {
    const dc = parseFloat(val) || 0
    setRows((r) => r.map((x) => (x.id === rowId ? { ...x, delivery_charge: dc } : x)))
    await supabase.from('customer_product_prices').update({ delivery_charge: dc, updated_at: new Date().toISOString() }).eq('id', rowId)
  }

  async function deleteRow(rowId) {
    setRows((r) => r.filter((x) => x.id !== rowId))
    await supabase.from('customer_product_prices').delete().eq('id', rowId)
  }

  // ---- quantity-break tiers (per saved price row) ----
  function rowById(id) { return rows.find((r) => r.id === id) }

  async function persistTiers(rowId, tiers) {
    setRows((r) => r.map((x) => (x.id === rowId ? { ...x, qty_tiers: tiers } : x)))
    await supabase.from('customer_product_prices')
      .update({ qty_tiers: tiers, updated_at: new Date().toISOString() }).eq('id', rowId)
  }

  function addTier(rowId) {
    const row = rowById(rowId)
    const existing = row?.qty_tiers || []
    const last = existing[existing.length - 1]
    const nextFrom = last ? ((last.to != null ? last.to : last.from) + 1) : 1
    const base = row?.price_per_litre || 0
    persistTiers(rowId, [...existing, { from: nextFrom, to: null, ppl: base }])
  }

  // Update a tier locally (string-friendly); save happens on blur.
  function updateTierLocal(rowId, idx, patch) {
    setRows((r) => r.map((x) => {
      if (x.id !== rowId) return x
      const tiers = (x.qty_tiers || []).map((t, i) => (i === idx ? { ...t, ...patch } : t))
      return { ...x, qty_tiers: tiers }
    }))
  }

  // Normalise a tier row's values to numbers and persist the whole array.
  function commitTiers(rowId) {
    const row = rowById(rowId)
    if (!row) return
    const clean = (row.qty_tiers || []).map((t) => ({
      from: parseInt(t.from) || 0,
      to: t.to === '' || t.to == null ? null : (parseInt(t.to) || null),
      ppl: parseFloat(t.ppl) || 0,
    }))
    persistTiers(rowId, clean)
  }

  function deleteTier(rowId, idx) {
    const row = rowById(rowId)
    const tiers = (row?.qty_tiers || []).filter((_, i) => i !== idx)
    persistTiers(rowId, tiers)
  }

  async function addRow() {
    if (!newRow.productId) { toast('Select a product'); return }
    if (!newRow.packagingId) { toast('Select a packaging size'); return }
    const ppl = (() => {
      if (newRow.ppl) return parseFloat(newRow.ppl) || 0
      const vol = pkgVol(newRow.packagingId)
      return vol > 0 ? (parseFloat(newRow.ppp) || 0) / vol : 0
    })()
    const dc = parseFloat(newRow.dc) || 0
    const { data, error } = await supabase.from('customer_product_prices')
      .insert({ customer_id: customerId, product_id: newRow.productId, packaging_id: newRow.packagingId, price_per_litre: ppl, delivery_charge: dc })
      .select('id, product_id, packaging_id, price_per_litre, delivery_charge').single()
    if (error) { toast(error.message); return }
    setRows((r) => [...r, data])
    setAdding(false)
    setNewRow({ productId: '', packagingId: '', ppl: '', ppp: '', dc: '' })
    toast('Price saved')
  }

  // Bulk-fill: drop in a draft row for every product in this customer's range
  // that doesn't already have a price. The user then just types the prices.
  function fillProducts() {
    if (!customerId) return
    const existing = new Set(rows.map((r) => r.product_id))
    const defaultPkg = packaging[0]?.id || ''
    const matches = products
      .filter((p) => matchesCustomer(p.category, selectedCustomer?.name) && !existing.has(p.id))
      .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name))
    setDrafts((prev) => {
      const have = new Set([...prev.map((d) => d.productId), ...existing])
      const added = matches
        .filter((p) => !have.has(p.id))
        .map((p) => ({ key: p.id, productId: p.id, packagingId: defaultPkg, ppl: '', ppp: '', dc: '' }))
      if (!added.length) { toast(prev.length ? 'No more products to add' : 'No unpriced products found for this customer'); return prev }
      toast(`Added ${added.length} product${added.length !== 1 ? 's' : ''} — enter prices and save`)
      return [...prev, ...added]
    })
  }

  function updateDraft(key, patch) {
    setDrafts((ds) => ds.map((d) => {
      if (d.key !== key) return d
      const next = { ...d, ...patch }
      const vol = pkgVol(next.packagingId)
      if ('ppl' in patch) next.ppp = vol > 0 ? ((parseFloat(next.ppl) || 0) * vol).toFixed(4) : ''
      if ('ppp' in patch) next.ppl = vol > 0 ? ((parseFloat(next.ppp) || 0) / vol).toFixed(6) : ''
      if ('packagingId' in patch) {
        if (next.ppl) next.ppp = vol > 0 ? ((parseFloat(next.ppl) || 0) * vol).toFixed(4) : ''
        else if (next.ppp) next.ppl = vol > 0 ? ((parseFloat(next.ppp) || 0) / vol).toFixed(6) : ''
      }
      return next
    }))
  }

  function removeDraft(key) {
    setDrafts((ds) => ds.filter((d) => d.key !== key))
  }

  // Add another blank draft row for the same product, so a second packaging
  // size / price can be entered without re-picking the product. Used both from
  // a draft row and from an already-saved row.
  function duplicateProduct(productId, afterKey) {
    dupSeq.current += 1
    const fresh = { key: `dup-${productId}-${dupSeq.current}`, productId, packagingId: '', ppl: '', ppp: '', dc: '' }
    setDrafts((ds) => {
      if (afterKey == null) return [...ds, fresh]
      const idx = ds.findIndex((d) => d.key === afterKey)
      if (idx < 0) return [...ds, fresh]
      const next = [...ds]
      next.splice(idx + 1, 0, fresh)
      return next
    })
    toast('Added another size — pick packaging and enter the price')
  }

  async function saveDrafts() {
    const toSave = drafts.filter((d) => d.packagingId && ((parseFloat(d.ppl) || 0) > 0 || (parseFloat(d.ppp) || 0) > 0))
    if (!toSave.length) { toast('Enter at least one price first'); return }
    const payload = toSave.map((d) => {
      const vol = pkgVol(d.packagingId)
      const ppl = d.ppl ? (parseFloat(d.ppl) || 0) : (vol > 0 ? (parseFloat(d.ppp) || 0) / vol : 0)
      return { customer_id: customerId, product_id: d.productId, packaging_id: d.packagingId, price_per_litre: ppl, delivery_charge: parseFloat(d.dc) || 0 }
    })
    const { error } = await supabase.from('customer_product_prices').insert(payload)
    if (error) { toast(error.message); return }
    const savedKeys = new Set(toSave.map((d) => d.key))
    setDrafts((ds) => ds.filter((d) => !savedKeys.has(d.key)))
    await loadPrices(customerId)
    toast(`${toSave.length} price${toSave.length !== 1 ? 's' : ''} saved`)
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

  // Searchable product options, with this customer's own range floated to the top.
  const productOptions = useMemo(() => {
    const opts = products.map((p) => ({
      id: p.id,
      base: p.category ? `${p.name} (${p.category})` : p.name,
      match: matchesCustomer(p.category, selectedCustomer?.name),
    }))
    opts.sort((a, b) => (b.match - a.match) || a.base.localeCompare(b.base))
    return opts.map((o) => ({ id: o.id, label: o.match ? `★ ${o.base}` : o.base }))
  }, [products, selectedCustomer])

  return (
    <PricingGuard>
    <div className="card">
      <div className="ttl">
        <h2>Customer Prices</h2>
        {customerId && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g btn-sm" onClick={fillProducts} title="Add all of this customer's range products">⤓ Fill products</button>
            <button className="btn btn-a btn-sm" onClick={() => { setAdding(true); setNewRow({ productId: '', packagingId: '', ppl: '', ppp: '', dc: '' }) }}>＋ Add price</button>
          </div>
        )}
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
              <th style={{ textAlign: 'right', width: '13%' }}>£ / Litre</th>
              <th style={{ textAlign: 'right', width: '13%' }}>£ / Pack</th>
              <th style={{ textAlign: 'right', width: '13%' }}>Delivery (£)</th>
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
                const tiers = row.qty_tiers || []
                const tiersOpen = tiersRowId === row.id
                return (
                  <Fragment key={row.id}>
                  <tr>
                    <td>{prod ? (prod.category ? `${prod.name} (${prod.category})` : prod.name) : <span className="muted">—</span>}</td>
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
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={row.delivery_charge > 0 ? row.delivery_charge : ''}
                        placeholder="0.00"
                        onChange={(e) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, delivery_charge: e.target.value } : x)))}
                        onBlur={(e) => handleDeliveryChange(row.id, e.target.value)}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className={'btn btn-sm ' + (tiersOpen ? 'btn-a' : 'btn-g')}
                        style={{ padding: '2px 7px', marginRight: 4 }}
                        title="Quantity-break pricing (price per litre changes with packs ordered)"
                        onClick={() => setTiersRowId(tiersOpen ? null : row.id)}
                      >{tiersOpen ? 'Close' : (tiers.length ? `⇅ ${tiers.length}` : '⇅')}</button>
                      <button className="btn btn-g btn-sm" style={{ padding: '2px 7px', marginRight: 4 }}
                        title="Add another packaging size for this product"
                        onClick={() => duplicateProduct(row.product_id, null)}>⧉</button>
                      <button className="btn-dl" onClick={() => deleteRow(row.id)}>×</button>
                    </td>
                  </tr>
                  {tiersOpen && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--panel-2)', padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 8 }}>
                          Quantity-break tiers — £/litre by number of {pkg?.name || 'packs'} ordered
                        </div>
                        {tiers.length === 0 && (
                          <p className="hint" style={{ marginBottom: 8 }}>
                            No tiers — the flat £{(row.price_per_litre || 0).toFixed(4)}/L above applies to every quantity. Add a tier below to charge less as more is ordered.
                          </p>
                        )}
                        {tiers.map((t, i) => {
                          const tPpl = parseFloat(t.ppl) || 0
                          const tPpp = vol > 0 ? tPpl * vol : 0
                          return (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>From</span>
                              <input className="mono" style={{ width: 56, textAlign: 'right' }} value={t.from ?? ''} placeholder="1"
                                onChange={(e) => updateTierLocal(row.id, i, { from: e.target.value })}
                                onBlur={() => commitTiers(row.id)} />
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
                              <input className="mono" style={{ width: 56, textAlign: 'right' }} value={t.to ?? ''} placeholder="∞"
                                onChange={(e) => updateTierLocal(row.id, i, { to: e.target.value })}
                                onBlur={() => commitTiers(row.id)} />
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pkg?.name || 'packs'} →</span>
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>£</span>
                              <input className="mono" style={{ width: 90, textAlign: 'right' }} value={t.ppl ?? ''} placeholder="0.0000"
                                onChange={(e) => updateTierLocal(row.id, i, { ppl: e.target.value })}
                                onBlur={() => commitTiers(row.id)} />
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>/L</span>
                              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 110 }}>
                                {tPpp > 0 ? `= £${tPpp.toFixed(2)} / pack` : ''}
                              </span>
                              <button className="btn-dl" onClick={() => deleteTier(row.id, i)} title="Remove tier">×</button>
                            </div>
                          )
                        })}
                        <button className="btn btn-g btn-sm" style={{ marginTop: 4 }} onClick={() => addTier(row.id)}>＋ Add tier</button>
                        <p className="hint" style={{ marginTop: 8 }}>
                          Leave <b>to</b> blank for the top band (e.g. “5 and above”). Bands should not overlap. Tiers show on the Price List and its PDF export.
                        </p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}

              {drafts.map((d) => {
                const prod = products.find((p) => p.id === d.productId)
                return (
                  <tr key={'draft-' + d.key} style={{ background: 'var(--draft-bg)' }}>
                    <td>{prod ? (prod.category ? `${prod.name} (${prod.category})` : prod.name) : <span className="muted">—</span>}</td>
                    <td>
                      <select value={d.packagingId} onChange={(e) => updateDraft(d.key, { packagingId: e.target.value })}>
                        <option value="">— packaging —</option>
                        {packaging.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={d.ppl} placeholder="£/L"
                        onChange={(e) => updateDraft(d.key, { ppl: e.target.value })} />
                    </td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={d.ppp} placeholder="£/pack"
                        onChange={(e) => updateDraft(d.key, { ppp: e.target.value })} />
                    </td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={d.dc} placeholder="£ delivery"
                        onChange={(e) => updateDraft(d.key, { dc: e.target.value })} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-g btn-sm" style={{ padding: '2px 7px', marginRight: 4 }}
                        title="Add another packaging size for this product"
                        onClick={() => duplicateProduct(d.productId, d.key)}>⧉</button>
                      <button className="btn-dl" onClick={() => removeDraft(d.key)}>×</button>
                    </td>
                  </tr>
                )
              })}

              {adding && (
                <tr style={{ background: 'var(--panel-2)' }}>
                  <td>
                    <Combobox
                      options={productOptions}
                      value={newRow.productId}
                      onSelect={(id) => updateNew({ productId: id })}
                      placeholder="Search product or range…"
                    />
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
                  <td>
                    <input className="mono" style={{ textAlign: 'right' }}
                      value={newRow.dc} placeholder="£ delivery"
                      onChange={(e) => setNewRow((n) => ({ ...n, dc: e.target.value }))}
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
          {drafts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 14px' }}>
              <button className="btn btn-a" onClick={saveDrafts}>Save filled prices</button>
              <button className="btn btn-g btn-sm" onClick={() => setDrafts([])}>Clear unfilled</button>
              <span className="muted" style={{ fontSize: 12 }}>{drafts.length} product{drafts.length !== 1 ? 's' : ''} added — rows with no price are ignored on save.</span>
            </div>
          )}
          <p className="hint">Use <b>⤓ Fill products</b> to load every product in this customer's range that has no price yet — then just type the prices and click <b>Save filled prices</b>. Type in the product box to search by product name or range — no need to scroll. Products marked ★ belong to this customer's own range and appear at the top. Enter either £/litre or £/pack — the other calculates automatically. Use the <b>⧉</b> button beside a product to add another row for a different packaging size of the same product. Use the <b>⇅</b> button to set quantity-break tiers, where the £/litre drops as more packs are ordered. Set a delivery charge for products that carry a mandatory delivery surcharge for this customer — it will auto-fill on the order page.</p>
        </>
      )}
      <ChangePassword />
    </div>
    </PricingGuard>
  )
}

function ChangePassword() {
  const supabase = createClient()
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)

  async function save() {
    if (!newPw) { setMsg({ err: true, text: 'Please enter a password' }); return }
    if (newPw !== confirm) { setMsg({ err: true, text: 'Passwords do not match' }); return }
    await supabase.from('app_settings').upsert({ key: 'pricing_password', value: newPw })
    setNewPw(''); setConfirm('')
    setMsg({ err: false, text: 'Password updated' })
    // Clear session so next visit requires re-entry
    if (typeof window !== 'undefined') sessionStorage.removeItem('pz_unlocked')
  }

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 14 }}>Change pricing password</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: 460 }}>
        <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
          <label>New password</label>
          <input type="password" value={newPw} onChange={(e) => { setNewPw(e.target.value); setMsg(null) }} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
          <label>Confirm password</label>
          <input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setMsg(null) }} />
        </div>
        <button className="btn btn-g btn-sm" style={{ marginBottom: 1 }} onClick={save}>Save password</button>
      </div>
      {msg && <p style={{ fontSize: 12, marginTop: 8, color: msg.err ? 'var(--bad)' : 'var(--accent)' }}>{msg.text}</p>}
      <p className="hint">Changing the password will require all users to re-enter it on their next visit to pricing.</p>
    </div>
  )
}
