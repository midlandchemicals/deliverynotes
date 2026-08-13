'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { computeLine, fmt } from '@/lib/calc'
import { createClient } from '@/lib/supabase/client'
import { lookupADR, adrTunnelForPG } from '@/lib/adr'
import { toast, toastError } from '@/lib/notify'

function InlineCombo({ options, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dropStyle, setDropStyle] = useState(null)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const selected = options.find((o) => o.id === value)
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  function calcDrop() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200), zIndex: 9999 })
    }
  }

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Keep the dropdown glued to the input while the page scrolls or resizes —
  // it's position:fixed, so without this it drifts away from the field.
  useEffect(() => {
    if (!open) return
    const sync = () => calcDrop()
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => { window.removeEventListener('scroll', sync, true); window.removeEventListener('resize', sync) }
  }, [open])

  const dropdown = open && filtered.length > 0 && dropStyle ? createPortal(
    <div className="combo-list" style={dropStyle}>
      {filtered.map((opt) => (
        <div
          key={opt.id}
          className={'combo-item' + (opt.id === value ? ' sel' : '')}
          onMouseDown={() => { onChange(opt.id); setQuery(''); setOpen(false) }}
        >
          {opt.label}
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <div ref={wrapRef}>
      <input
        ref={inputRef}
        value={open ? query : (selected?.label || '')}
        onChange={(e) => { setQuery(e.target.value); calcDrop(); setOpen(true) }}
        onFocus={() => { calcDrop(); setOpen(true); setQuery('') }}
        placeholder="Search…"
        autoComplete="off"
        style={{ fontSize: 12.5, padding: '7px 8px' }}
      />
      {dropdown}
    </div>
  )
}

// onProductUpdated(product) — the parent refreshes its products list so the
// weights and hazard text on the order redraw with the saved values.
export default function LineEditor({ lines, setLines, products, packaging, availableByProduct, onProductUpdated }) {
  const supabase = createClient()
  const [hazEdit, setHazEdit] = useState(null)   // product being edited
  const [sgDraft, setSgDraft] = useState({})     // productId -> typed SG, before it's committed
  const [sgPrompt, setSgPrompt] = useState(null) // { product, next }
  const [busy, setBusy] = useState(false)

  function update(i, k, v) {
    const next = lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))
    setLines(next)
  }

  // When a product is chosen, auto-fill the packaging with the sizes that
  // already exist for this product (from the customer's price list). If only
  // one size exists, use it; if several, default to the smallest volume.
  function pickProduct(i, productId) {
    const avail = availableByProduct?.[productId] || []
    const patch = { productId }
    if (avail.length) {
      const lowest = avail
        .map((pid) => packaging.find((k) => k.id === pid))
        .filter(Boolean)
        .sort((a, b) => (a.volume || 0) - (b.volume || 0))[0]
      if (lowest) patch.packagingId = lowest.id
    }
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function remove(i) {
    setLines(lines.filter((_, idx) => idx !== i))
  }

  // ── SG ────────────────────────────────────────────────────────────────────
  // SG belongs to the product, not the order line, so a change here is always a
  // change to the catalogue. Ask before committing rather than doing it quietly.
  function sgBlur(product, typed) {
    const next = parseFloat(typed)
    const current = parseFloat(product.sg) || 0
    if (!typed.trim() || isNaN(next) || next <= 0) { clearSgDraft(product.id); return }
    if (next === current) { clearSgDraft(product.id); return }
    setSgPrompt({ product, next })
  }
  function clearSgDraft(productId) {
    setSgDraft((d) => { const n = { ...d }; delete n[productId]; return n })
  }
  async function saveSg() {
    const { product, next } = sgPrompt
    setBusy(true)
    const { error } = await supabase.from('products').update({ sg: next }).eq('id', product.id)
    setBusy(false)
    if (error) { toastError('Could not save the SG: ' + error.message); return }
    onProductUpdated?.({ ...product, sg: next })
    clearSgDraft(product.id)
    setSgPrompt(null)
    toast(`SG for ${product.name} saved as ${next} — weights updated`)
  }

  // ── Hazard ────────────────────────────────────────────────────────────────
  async function saveHazard() {
    const h = hazEdit
    setBusy(true)
    const patch = {
      un_number: (h.un_number || '').trim(), pg: (h.pg || '').trim(),
      adr_class: (h.adr_class || '').trim(), adr_subsidiary: (h.adr_subsidiary || '').trim(),
      adr_tunnel: (h.adr_tunnel || '').trim(), adr_transport_cat: (h.adr_transport_cat || '').trim(),
      adr_psn: (h.adr_psn || '').trim(),
      // Edited by hand — it needs re-checking on the Products page.
      adr_verified_by: '', adr_verified_at: null,
    }
    const { error } = await supabase.from('products').update(patch).eq('id', h.id)
    setBusy(false)
    if (error) { toastError('Could not save the hazard details: ' + error.message); return }
    onProductUpdated?.({ ...products.find((p) => p.id === h.id), ...patch })
    setHazEdit(null)
    toast(`Hazard details saved for ${h.name} — updated on the Products page too`)
  }

  // Pull class / subsidiary / tunnel / shipping name straight from the ADR table.
  function fillHazardFromAdr() {
    const entry = lookupADR((hazEdit.un_number || '').trim())
    if (!entry) { toastError('That UN number is not in the ADR table — enter the details by hand'); return }
    const cur = String(hazEdit.pg || '').replace(/^PG\s*/i, '').trim().toUpperCase()
    const pg = entry.pgOptions?.includes(cur) ? cur : (entry.pgOptions?.[0] || '')
    setHazEdit((h) => ({
      ...h, pg, adr_class: entry.class || '', adr_subsidiary: entry.subsidiary || '',
      adr_tunnel: adrTunnelForPG((h.un_number || '').trim(), pg),
      adr_psn: h.adr_psn?.trim() ? h.adr_psn : (entry.name || ''),
    }))
  }

  const productOptions = products.map((p) => ({
    id: p.id,
    label: p.category ? `${p.name} (${p.category})` : p.name,
  }))
  const packagingOptions = packaging.map((k) => ({ id: k.id, label: k.name }))

  return (
    <div>
      <table className="tbl tbl-cards">
        <thead>
          <tr>
            <th style={{ width: '24%' }}>Product</th>
            <th style={{ width: '20%' }}>Hazard / UN</th>
            <th style={{ width: '9%' }}>SG</th>
            <th style={{ width: '18%' }}>Packaging</th>
            <th style={{ width: '8%' }}>Qty</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Net kg</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Gross kg</th>
            <th style={{ width: '4%' }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const c = computeLine(l, products, packaging)
            const p = c.product
            return (
              <tr key={i}>
                <td data-label="Product">
                  <InlineCombo
                    options={productOptions}
                    value={l.productId || ''}
                    onChange={(v) => pickProduct(i, v)}
                  />
                </td>
                <td data-label="Hazard / UN">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="pgtag">{c.hazard}</span>
                    {p && (
                      <button type="button" title="Edit the hazard details for this product"
                        onClick={() => setHazEdit({ ...p })}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '0 2px' }}>
                        ✎
                      </button>
                    )}
                  </span>
                </td>
                <td data-label="SG">
                  {p ? (
                    <input
                      className="mono" style={{ textAlign: 'right' }}
                      value={sgDraft[p.id] ?? (p.sg ?? '')}
                      title="Specific gravity from the product list — change it to update the product"
                      onChange={(e) => setSgDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      onBlur={(e) => sgBlur(p, e.target.value)}
                    />
                  ) : <span className="pgtag">—</span>}
                </td>
                <td data-label="Packaging">
                  <InlineCombo
                    options={packagingOptions}
                    value={l.packagingId || ''}
                    onChange={(v) => update(i, 'packagingId', v)}
                  />
                </td>
                <td data-label="Qty">
                  <input className="mono" style={{ textAlign: 'right' }} value={l.qty}
                    onChange={(e) => update(i, 'qty', e.target.value)} />
                </td>
                <td className="calc" data-label="Net kg">{fmt(c.net)}</td>
                <td className="calc" data-label="Gross kg">{fmt(c.gross)}</td>
                <td className="td-act" data-label="Remove"><button type="button" className="btn-dl" onClick={() => remove(i)}>×</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Confirm before an SG change is written to the catalogue. */}
      {sgPrompt && (
        <div className="modal-bg" onClick={() => !busy && (clearSgDraft(sgPrompt.product.id), setSgPrompt(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left', padding: 0, overflow: 'hidden' }}>
            <div style={{ background: '#B07E28', color: '#fff', padding: '14px 20px' }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>⚠ Change the SG for good?</div>
              <div style={{ fontSize: 13, marginTop: 2, opacity: .95 }}>SG belongs to the product, not just this order.</div>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{sgPrompt.product.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', fontWeight: 700 }}>Was</div>
                  <div className="mono" style={{ fontSize: 17, textDecoration: 'line-through', color: 'var(--muted)' }}>{sgPrompt.product.sg ?? '—'}</div>
                </div>
                <div style={{ fontSize: 22, color: 'var(--muted)' }}>→</div>
                <div>
                  <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--accent)', fontWeight: 700 }}>New</div>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>{sgPrompt.next}</div>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                Saving changes the SG on the <b>Products page</b>, so the net and gross weights on{' '}
                <b>this order and every future order</b> of {sgPrompt.product.name} are worked out from {sgPrompt.next}.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn btn-g" disabled={busy}
                  onClick={() => { clearSgDraft(sgPrompt.product.id); setSgPrompt(null) }}>
                  No — keep {sgPrompt.product.sg ?? '—'}
                </button>
                <button className="btn btn-a" onClick={saveSg} disabled={busy}>
                  {busy ? 'Saving…' : `Yes — save ${sgPrompt.next} as the SG`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit the product's hazard details without leaving the order. */}
      {hazEdit && (
        <div className="modal-bg" onClick={() => !busy && setHazEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 4 }}>Hazard details — {hazEdit.name}</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
              Saved against the product, so it updates the <b>Products page</b> and every order that uses it.
              It will show as <b>unverified</b> until someone signs it off there.
            </p>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>UN number</label>
                <input className="mono" value={hazEdit.un_number || ''} placeholder="e.g. 1789"
                  onChange={(e) => setHazEdit((h) => ({ ...h, un_number: e.target.value }))} /></div>
              <div className="field"><label>Packing group</label>
                <input className="mono" value={hazEdit.pg || ''} placeholder="e.g. II"
                  onChange={(e) => setHazEdit((h) => ({ ...h, pg: e.target.value }))} /></div>
            </div>
            <button type="button" className="btn btn-g btn-sm" style={{ marginBottom: 10 }} onClick={fillHazardFromAdr}>
              ↺ Fill the rest from the ADR table
            </button>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Hazard class</label>
                <input className="mono" value={hazEdit.adr_class || ''} placeholder="e.g. 8"
                  onChange={(e) => setHazEdit((h) => ({ ...h, adr_class: e.target.value }))} /></div>
              <div className="field"><label>Subsidiary risk</label>
                <input className="mono" value={hazEdit.adr_subsidiary || ''} placeholder="e.g. 6.1"
                  onChange={(e) => setHazEdit((h) => ({ ...h, adr_subsidiary: e.target.value }))} /></div>
            </div>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Tunnel code</label>
                <input className="mono" value={hazEdit.adr_tunnel || ''} placeholder="e.g. (E)"
                  onChange={(e) => setHazEdit((h) => ({ ...h, adr_tunnel: e.target.value }))} /></div>
              <div className="field"><label>Transport category</label>
                <input className="mono" value={hazEdit.adr_transport_cat || ''} placeholder="e.g. 2"
                  onChange={(e) => setHazEdit((h) => ({ ...h, adr_transport_cat: e.target.value }))} /></div>
            </div>
            <div className="field">
              <label>Proper shipping name</label>
              <input value={hazEdit.adr_psn || ''}
                placeholder="e.g. CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (contains hydrochloric acid)"
                onChange={(e) => setHazEdit((h) => ({ ...h, adr_psn: e.target.value }))} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => setHazEdit(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-a" onClick={saveHazard} disabled={busy}>{busy ? 'Saving…' : 'Save to the product'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
