'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { lookupADR, adrTunnelForPG } from '@/lib/adr'
import { toastError } from '@/lib/notify'
import Combobox from '@/app/(app)/Combobox'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Shared "add a product to this order" flow. Deliberately starts with a big,
// unmissable two-way choice so a rushing user can't confuse "add one we have"
// with "create a brand-new one". Used on the new-order and order-detail pages.
//
// onDone({ line:{productId,packagingId,qty}, product, packagingId, priceSaved, created, addedToRange })
export default function AddProductModal({ open, onClose, products, packaging, customerId, customerName, isAdmin, onDone, availableByProduct = {} }) {
  const supabase = createClient()
  const [step, setStep] = useState('choose') // 'choose' | 'existing' | 'new'
  // 'range' = only what this customer already buys, 'all' = everything we make
  const [exScope, setExScope] = useState('range')
  const [busy, setBusy] = useState(false)

  // existing-product form
  const [exProduct, setExProduct] = useState('')
  const [exPack, setExPack] = useState('')
  const [exQty, setExQty] = useState('1')
  const [exToRange, setExToRange] = useState(false)
  const [exPpl, setExPpl] = useState('')

  // new-product form
  const [nName, setNName] = useState('')
  const [nRange, setNRange] = useState('')
  const [nSg, setNSg] = useState('')
  const [nUn, setNUn] = useState('')
  const [nPack, setNPack] = useState('')
  const [nQty, setNQty] = useState('1')
  const [nPpl, setNPpl] = useState('')
  // full hazard / transport detail — prefilled from the ADR table or copied
  // from another product, and always editable before the product is created.
  const [nPg, setNPg] = useState('')
  const [nClass, setNClass] = useState('')
  const [nSub, setNSub] = useState('')
  const [nTunnel, setNTunnel] = useState('')
  const [nTcat, setNTcat] = useState('')
  const [nPsn, setNPsn] = useState('')
  const [hazSource, setHazSource] = useState('')  // note shown above the hazard fields

  if (!open) return null

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort()
  const custLabel = customerName || 'this customer'

  // What this customer already buys, per their price list.
  const rangeProducts = products.filter((p) => (availableByProduct[p.id] || []).length > 0)
  const inRange = exScope === 'range' && rangeProducts.length > 0
  const exOptions = inRange ? rangeProducts : products
  // In range mode, offer only the sizes they're actually priced for.
  const rangePacks = step === 'existing' && inRange && exProduct ? (availableByProduct[exProduct] || []) : null
  const packOpts = [...packaging]
    .filter((k) => !rangePacks || rangePacks.includes(k.id))
    .sort((a, b) => (a.volume || 0) - (b.volume || 0))

  // live "did you mean an existing product?" check on the new-product name
  const dupMatches = nName.trim().length >= 3
    ? products.filter((p) => norm(p.name).includes(norm(nName)) || norm(nName).includes(norm(p.name))).slice(0, 5)
    : []

  function reset() {
    setStep('choose'); setBusy(false); setExScope('range')
    setExProduct(''); setExPack(''); setExQty('1'); setExToRange(false); setExPpl('')
    setNName(''); setNRange(''); setNSg(''); setNUn(''); setNPack(''); setNQty('1'); setNPpl('')
    setNPg(''); setNClass(''); setNSub(''); setNTunnel(''); setNTcat(''); setNPsn(''); setHazSource('')
  }
  function close() { reset(); onClose() }

  // Jump from the "new" screen straight into adding a matched existing product.
  function useExistingInstead(p) {
    setExScope('all'); setExProduct(p.id); setExPack(''); setExQty(nQty || '1'); setStep('existing')
  }

  // Copy EVERYTHING that describes the hazard from another product — UN number,
  // packing group, class, subsidiary risk, tunnel code, transport category and
  // the proper shipping name (which carries the "contains …" technical name).
  function copyFrom(p) {
    if (!p) return
    setNSg(String(p.sg ?? ''))
    setNUn(p.un_number || '')
    if (!nRange) setNRange(p.category || '')
    setNPg(p.pg || '')
    setNClass(p.adr_class || '')
    setNSub(p.adr_subsidiary || '')
    setNTunnel(p.adr_tunnel || '')
    setNTcat(p.adr_transport_cat || '')
    setNPsn(p.adr_psn || '')
    setHazSource(`Copied from ${p.name} — check it, and edit anything that differs.`)
  }

  // Typing a UN number fills the hazard detail from the ADR table. It never
  // silently overwrites a "contains …" shipping name that's already been typed.
  function changeUn(v) {
    setNUn(v)
    const entry = v.trim() ? lookupADR(v.trim()) : null
    if (!entry) return
    const pg = entry.pgOptions?.includes(String(nPg).replace(/^PG\s*/i, '').trim().toUpperCase())
      ? nPg : (entry.pgOptions?.[0] || '')
    setNPg(pg)
    setNClass(entry.class || '')
    setNSub(entry.subsidiary || '')
    setNTunnel(adrTunnelForPG(v.trim(), pg))
    if (!nPsn.trim()) setNPsn(entry.name || '')
    setHazSource(`Filled in from the ADR table for UN ${v.trim()} — check it, and edit anything that differs.`)
  }

  // Keep the tunnel code in step when the packing group is changed by hand.
  function changePg(v) {
    setNPg(v)
    if (nUn.trim() && lookupADR(nUn.trim())) setNTunnel(adrTunnelForPG(nUn.trim(), v))
  }

  async function addExisting() {
    if (!exProduct) { toastError('Pick the product from the list first'); return }
    if (!exPack) { toastError('Choose a packaging size'); return }
    setBusy(true)
    let priceSaved = null
    if (isAdmin && exToRange) {
      const ppl = parseFloat(exPpl) || 0
      await supabase.from('customer_product_prices').upsert(
        { customer_id: customerId, product_id: exProduct, packaging_id: exPack, price_per_litre: ppl, updated_at: new Date().toISOString() },
        { onConflict: 'customer_id,product_id,packaging_id' })
      priceSaved = ppl
    }
    setBusy(false)
    onDone({
      line: { productId: exProduct, packagingId: exPack, qty: String(parseInt(exQty) || 1) },
      product: products.find((p) => p.id === exProduct), packagingId: exPack,
      priceSaved, created: false, addedToRange: isAdmin && exToRange,
    })
    close()
  }

  async function createNew() {
    if (!nName.trim()) { toastError('Enter the product name'); return }
    const sg = parseFloat(nSg)
    if (!sg || sg <= 0) { toastError('Enter the SG (needed to work out the weights)'); return }
    if (!nPack) { toastError('Choose a packaging size'); return }
    setBusy(true)
    // Whatever is on screen is what gets saved — the fields are prefilled from
    // the ADR table or a copied product, but the user's edits always win.
    const patch = {
      name: nName.trim(), sg, un_number: nUn.trim(), category: nRange.trim(),
      pg: nPg.trim(), adr_class: nClass.trim(), adr_subsidiary: nSub.trim(),
      adr_tunnel: nTunnel.trim(), adr_psn: nPsn.trim(), adr_transport_cat: nTcat.trim(),
      adr_verified_by: '', adr_verified_at: null,
    }
    const { data, error } = await supabase.from('products').insert(patch).select('*').single()
    if (error || !data) { setBusy(false); toastError('Could not create the product: ' + (error?.message || '')); return }
    let priceSaved = null
    const ppl = parseFloat(nPpl) || 0
    if (isAdmin && ppl > 0) {
      await supabase.from('customer_product_prices').upsert(
        { customer_id: customerId, product_id: data.id, packaging_id: nPack, price_per_litre: ppl, updated_at: new Date().toISOString() },
        { onConflict: 'customer_id,product_id,packaging_id' })
      priceSaved = ppl
    }
    setBusy(false)
    onDone({
      line: { productId: data.id, packagingId: nPack, qty: String(parseInt(nQty) || 1) },
      product: data, packagingId: nPack, priceSaved, created: true, addedToRange: isAdmin && ppl > 0,
    })
    close()
  }

  return (
    <div className="modal-bg" onClick={() => !busy && close()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'left' }}>

        {/* STEP 1 — big, unmistakable choice */}
        {step === 'choose' && (
          <>
            <h2 style={{ marginBottom: 6 }}>Add a product to this order</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>Which one is it?</p>
            <button
              onClick={() => { setExScope('range'); setExProduct(''); setExPack(''); setStep('existing') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 12,
                border: '2px solid var(--accent)', background: 'var(--accent-soft, #E7F2EB)', borderRadius: 12, padding: '16px 18px', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>✅ Something {custLabel} ALREADY BUYS</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>
                Their usual range — already priced up.{' '}
                <b>This is almost always the right one.</b>
                {rangeProducts.length > 0 ? ` (${rangeProducts.length} product${rangeProducts.length === 1 ? '' : 's'})` : ' — nothing on their list yet, so use the next option.'}
              </div>
            </button>
            <button
              onClick={() => { setExScope('all'); setExProduct(''); setExPack(''); setStep('existing') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 12,
                border: '2px solid var(--line-solid)', background: 'var(--panel-2)', borderRadius: 12, padding: '16px 18px', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--heading)' }}>📦 Something else WE MAKE</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>
                Anything in our full product list that {custLabel} hasn&apos;t bought before. <b>It will need a price.</b>
              </div>
            </button>
            <button
              onClick={() => setStep('new')}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                border: '2px solid var(--warn, #B07E28)', background: '#FCF4E2', borderRadius: 12, padding: '16px 18px', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: '#7A5511' }}>🆕 A BRAND-NEW product we've never sold</div>
              <div style={{ fontSize: 13, color: '#7A5511', marginTop: 4 }}>Creates a new product in the catalogue. <b>Only if it's genuinely not in our list.</b></div>
            </button>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-g" onClick={close}>Cancel</button>
            </div>
          </>
        )}

        {/* STEP 2a — add an existing product */}
        {step === 'existing' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>{inRange ? `✅ From ${custLabel}'s range` : '📦 From everything we make'}</h2>
              <button className="btn btn-g btn-sm" onClick={() => setStep('choose')}>← Back</button>
            </div>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>Search the product → choose the size → add.</p>

            {!inRange && rangeProducts.length > 0 && (
              <p className="hint" style={{ marginTop: 0, marginBottom: 12, background: 'var(--panel-2)', border: '1px solid var(--line-solid)', borderRadius: 8, padding: '8px 12px' }}>
                You&apos;re searching <b>every product we make</b>, not just {custLabel}&apos;s usual range.{' '}
                <a style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => { setExScope('range'); setExProduct(''); setExPack('') }}>
                  Show only their range instead
                </a>
              </p>
            )}

            <div className="field" style={{ marginBottom: 10 }}>
              <label>1. Product</label>
              <Combobox
                options={exOptions.map((p) => ({ id: p.id, label: p.category ? `${p.name} (${p.category})` : p.name }))}
                value={exProduct}
                onSelect={(id) => { setExProduct(id); setExPack('') }}
                placeholder={inRange ? `Search ${custLabel}'s products…` : 'Type the product name to search…'}
              />
              {inRange && (
                <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                  Not in the list?{' '}
                  <a style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { setExScope('all'); setExProduct(''); setExPack('') }}>
                    Search everything we make
                  </a>
                </p>
              )}
            </div>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>2. Packaging size{rangePacks ? ' (their sizes)' : ''}</label>
                <select value={exPack} onChange={(e) => setExPack(e.target.value)}>
                  <option value="">— choose —</option>
                  {packOpts.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select></div>
              <div className="field"><label>3. Quantity</label>
                <input className="mono" type="number" min="1" value={exQty} onChange={(e) => setExQty(e.target.value)} /></div>
            </div>

            {!inRange && exProduct && !(availableByProduct[exProduct] || []).length && (
              <p className="hint" style={{ marginTop: 8, marginBottom: 0, background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '8px 12px', color: '#7A5511', fontWeight: 600 }}>
                ⚠ {custLabel} has no price for this product yet — {isAdmin ? 'tick below to add it to their price list.' : 'an admin will need to price it.'}
              </p>
            )}

            {isAdmin && (
              <div style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 13, cursor: 'pointer', margin: 0 }}>
                  <input type="checkbox" checked={exToRange} onChange={(e) => setExToRange(e.target.checked)} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                  Also save this to {custLabel}'s price list (so it's in their range next time)
                </label>
                {exToRange && (
                  <div className="field" style={{ marginTop: 8, maxWidth: 220 }}>
                    <label>£ / litre for {custLabel}</label>
                    <input className="mono" value={exPpl} onChange={(e) => setExPpl(e.target.value)} placeholder="leave blank to price later" />
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn btn-a" onClick={addExisting} disabled={busy}>{busy ? 'Adding…' : '＋ Add to order'}</button>
            </div>
          </>
        )}

        {/* STEP 2b — create a brand-new product */}
        {step === 'new' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h2 style={{ margin: 0, color: '#7A5511' }}>🆕 Create a brand-new product</h2>
              <button className="btn btn-g btn-sm" onClick={() => setStep('choose')}>← Back</button>
            </div>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12, background: '#FCF4E2', border: '2px solid var(--warn, #B07E28)', borderRadius: 8, padding: '10px 12px', color: '#7A5511', fontWeight: 600 }}>
              ⚠ STOP — only do this if we have <u>never</u> sold this product before. If we already sell it, go back and use <b>“A product we already sell”</b>.
            </p>

            {dupMatches.length > 0 && (
              <div style={{ marginBottom: 12, border: '1px solid var(--bad, #C24E42)', borderRadius: 8, padding: '10px 12px', background: '#FBEEEC' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--bad, #C24E42)', marginBottom: 6 }}>These look similar — is it one of these? (Don't make a duplicate!)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dupMatches.map((p) => (
                    <button key={p.id} className="btn btn-g btn-sm" style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => useExistingInstead(p)}>
                      <span>{p.category ? `${p.name} (${p.category})` : p.name}</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>← use this one</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Product name</label>
                <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="e.g. Marpol Spot Off" /></div>
              <div className="field"><label>Range</label>
                <input value={nRange} onChange={(e) => setNRange(e.target.value)} placeholder="e.g. August Race" list="apm-ranges" />
                <datalist id="apm-ranges">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <label>Copy SG + all hazard details from an existing product (optional)</label>
              <Combobox
                options={products.map((p) => ({ id: p.id, label: p.category ? `${p.name} (${p.category})` : p.name }))}
                value=""
                onSelect={(id) => copyFrom(products.find((x) => x.id === id))}
                placeholder="Search a similar product to copy from…"
              />
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                💡 Copies the SG, UN number, packing group, class, tunnel code and the shipping name (e.g. “contains hydrochloric acid”). You can edit any of it below.
              </p>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>SG (for weights)</label>
                <input className="mono" value={nSg} onChange={(e) => setNSg(e.target.value)} placeholder="e.g. 1.10" /></div>
              <div className="field"><label>UN number (optional)</label>
                <input className="mono" value={nUn} onChange={(e) => changeUn(e.target.value)} placeholder="e.g. 1993" /></div>
            </div>

            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginTop: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: hazSource ? 4 : 8 }}>
                Hazard / transport details — all editable
              </div>
              {hazSource && (
                <p className="hint" style={{ marginTop: 0, marginBottom: 8, color: 'var(--accent)', fontWeight: 600 }}>✓ {hazSource}</p>
              )}
              <div className="row c2" style={{ marginBottom: 0 }}>
                <div className="field"><label>Packing group</label>
                  <input className="mono" value={nPg} onChange={(e) => changePg(e.target.value)} placeholder="e.g. II" /></div>
                <div className="field"><label>Hazard class</label>
                  <input className="mono" value={nClass} onChange={(e) => setNClass(e.target.value)} placeholder="e.g. 8" /></div>
              </div>
              <div className="row c2" style={{ marginBottom: 0 }}>
                <div className="field"><label>Subsidiary risk</label>
                  <input className="mono" value={nSub} onChange={(e) => setNSub(e.target.value)} placeholder="e.g. 6.1" /></div>
                <div className="field"><label>Tunnel code</label>
                  <input className="mono" value={nTunnel} onChange={(e) => setNTunnel(e.target.value)} placeholder="e.g. (E)" /></div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}><label>Transport category</label>
                <input className="mono" value={nTcat} onChange={(e) => setNTcat(e.target.value)} placeholder="e.g. 2" style={{ maxWidth: 120 }} /></div>
              <div className="field" style={{ marginBottom: 0, marginTop: 8 }}>
                <label>Proper shipping name</label>
                <input value={nPsn} onChange={(e) => setNPsn(e.target.value)}
                  placeholder="e.g. CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (contains hydrochloric acid)" />
              </div>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Packaging size</label>
                <select value={nPack} onChange={(e) => setNPack(e.target.value)}>
                  <option value="">— choose —</option>
                  {packOpts.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select></div>
              <div className="field"><label>Quantity</label>
                <input className="mono" type="number" min="1" value={nQty} onChange={(e) => setNQty(e.target.value)} /></div>
            </div>

            {isAdmin ? (
              <div className="field" style={{ marginBottom: 4, maxWidth: 240 }}>
                <label>£ / litre for {custLabel} (optional)</label>
                <input className="mono" value={nPpl} onChange={(e) => setNPpl(e.target.value)} placeholder="leave blank to price later" />
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 2 }}>💡 An admin will add the price — this product will show as unpriced on the order for them.</p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn btn-a" onClick={createNew} disabled={busy}>{busy ? 'Creating…' : '🆕 Create & add to order'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
