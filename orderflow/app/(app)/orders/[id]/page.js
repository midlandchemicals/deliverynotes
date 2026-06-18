'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, splitContact, labelCount } from '@/lib/calc'
import { generateDispatchPDF, generateOfficeCopyPDF, reprintPDF } from '@/lib/pdf'
import { StatusBadge } from '../../page'
import LineEditor from '../LineEditor'

const STATUS_FLOW = ['New', 'In progress', 'Delivery Note Generated']

export default function OrderDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [order, setOrder] = useState(null)
  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [letterheads, setLetterheads] = useState([])
  const [lines, setLines] = useState([])
  const [dispatched, setDispatched] = useState([])

  // pricing: { [productId]: pricePerLitre }
  const [prices, setPrices] = useState({})
  const [deliveryCharge, setDeliveryCharge] = useState('')
  const [labelPrice, setLabelPrice] = useState(0)  // £ per label for this customer

  // dispatch panel state
  const [lhIndex, setLhIndex] = useState(0)
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceTo, setInvoiceTo] = useState('')
  const [options, setOptions] = useState('')
  const [pallets, setPallets] = useState('')
  const [noPallets, setNoPallets] = useState(false)
  const [palletsFlash, setPalletsFlash] = useState(false)
  const [showHazard, setShowHazard] = useState(true)
  const [batchModal, setBatchModal] = useState(null) // null | [{ name, batch, na }]
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const [o, p, k, lh] = await Promise.all([
        supabase.from('orders').select('*').eq('id', id).single(),
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
        supabase.from('letterheads').select('*').order('name'),
      ])
      const lhData = lh.data || []
      setOrder(o.data); setProducts(p.data || []); setPackaging(k.data || []); setLetterheads(lhData)
      setLines(o.data?.lines || [])

      // Default to Midland Chem letterhead if it exists
      const midlandIdx = lhData.findIndex(
        (l) => l.name.toLowerCase().includes('midland') || l.company.toLowerCase().includes('midland')
      )
      setLhIndex(midlandIdx >= 0 ? midlandIdx : 0)
      // Strip any contact lines so the Invoice To box never carries
      // tel / email / contact name
      setInvoiceTo(splitContact(o.data?.customer_snapshot?.details || '').address)

      const existing = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
      setDispatched(existing.data || [])

      if (o.data?.customer_id) {
        const [priceData, custData] = await Promise.all([
          supabase.from('customer_product_prices')
            .select('product_id, packaging_id, price_per_litre').eq('customer_id', o.data.customer_id),
          supabase.from('customers').select('label_price').eq('id', o.data.customer_id).single(),
        ])
        if (priceData.data?.length) {
          setPrices(Object.fromEntries(priceData.data.map((r) => [`${r.product_id}::${r.packaging_id}`, r.price_per_litre])))
        }
        setLabelPrice(custData.data?.label_price || 0)
      }
    })()
  }, [id])

  async function setStatus(status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrder({ ...order, status })
  }

  async function saveLines() {
    await supabase.from('orders').update({ lines }).eq('id', id)
    setOrder({ ...order, lines })
    toast('Products saved')
  }

  async function savePrice(productId, packagingId, price) {
    if (!order?.customer_id) return
    await supabase.from('customer_product_prices').upsert(
      { customer_id: order.customer_id, product_id: productId, packaging_id: packagingId, price_per_litre: price, updated_at: new Date().toISOString() },
      { onConflict: 'customer_id,product_id,packaging_id' }
    )
  }

  function printOfficeCopy(d) {
    const unpriced = lines.filter((l) => {
      const c = computeLine(l, products, packaging)
      return (parseFloat(prices[`${c.product?.id}::${c.packaging?.id}`]) || 0) === 0
    })
    if (unpriced.length > 0) {
      const names = unpriced.map((l) => computeLine(l, products, packaging).productName).join(', ')
      toast(`No price set for: ${names}`)
      return
    }
    const lh = letterheads[lhIndex]
    const batches = (d.lines_snapshot || []).map((s) => s.batch || '')
    const doc_ = {
      docNo: d.doc_no, date: d.doc_date,
      invoiceTo: d.customer, deliver: d.deliver,
      contact: d.totals?.contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options: d.options,
      pallets: d.totals?.pallets || 0, batches,
    }
    generateOfficeCopyPDF(doc_, lh, products, packaging, prices, parseFloat(deliveryCharge) || 0, labelTotal)
  }

  function printNote() {
    const items = lines.map((l) => {
      const c = computeLine(l, products, packaging)
      return { name: c.productName, qty: c.qty, pack: c.packaging?.name || '' }
    })
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${order.order_no}</title>
<style>
@page{size:80mm auto;margin:4mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:13pt;color:#000;background:#fff;width:72mm}
.dn{font-size:15pt;font-weight:700;border-bottom:2px solid #000;padding-bottom:2.5mm;margin-bottom:3mm}
.cust{font-size:18pt;font-weight:700;margin-bottom:3mm;line-height:1.2}
.dates{font-size:11pt;margin-bottom:4mm;line-height:1.6}
.ph{font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    border-bottom:1px solid #000;padding-bottom:1mm;margin-bottom:2.5mm}
ul{list-style:disc;padding-left:5mm}
li{font-size:13pt;margin-bottom:2.5mm;line-height:1.3}
b{font-weight:700}
</style>
</head><body>
<div class="dn">${order.order_no}</div>
<div class="cust">${order.customer_snapshot?.name || ''}</div>
<div class="dates">
  <div>Ordered: <b>${prettyDate(order.order_date)}</b></div>
  ${order.requested_date ? `<div>Required: <b>${prettyDate(order.requested_date)}</b></div>` : ''}
</div>
<div class="ph">Products</div>
<ul>
${items.map((it) => `  <li>${it.name}${it.pack ? ` — ${it.qty} x ${it.pack}` : ` (qty ${it.qty})`}</li>`).join('\n')}
</ul>
</body></html>`
    const w = window.open('', '_blank', 'width=420,height=600')
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  // Step 1 — validate, then open the batch-number modal
  function startDispatch() {
    const lh = letterheads[lhIndex]
    if (!lh) { alert('Add a letterhead first (Letterheads tab).'); return }
    if (!noPallets && (!pallets || parseInt(pallets, 10) <= 0)) {
      setPalletsFlash(true)
      setTimeout(() => setPalletsFlash(false), 1200)
      toast('Please enter number of pallets, or tick "No pallets"')
      return
    }
    // Warn if any hazmat product has not been verified against its SDS
    const unverifiedNames = lines.reduce((acc, l) => {
      const p = products.find((x) => x.id === l.productId)
      if (p?.un_number && !p?.adr_verified_by) acc.push(p.name)
      return acc
    }, [])
    if (unverifiedNames.length > 0) {
      const list = unverifiedNames.map((n) => `• ${n}`).join('\n')
      if (!confirm(`The following hazmat products have not been verified against their SDS:\n\n${list}\n\nADR hazard notation may be incomplete. Proceed anyway?`)) return
    }
    const rows = lines.map((l) => {
      const c = computeLine(l, products, packaging)
      return { name: c.packaging?.name ? `${c.productName} — ${c.qty} x ${c.packaging.name}` : c.productName, batch: '', na: false }
    })
    setBatchModal(rows)
  }

  function setBatchRow(i, patch) {
    setBatchModal((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  // Step 2 — every line must have a batch number OR be marked Not Applicable
  async function confirmDispatch() {
    const incomplete = batchModal.some((r) => !r.na && !r.batch.trim())
    if (incomplete) { toast('Enter a batch number or tick Not Applicable for each product'); return }
    setBusy(true)
    const lh = letterheads[lhIndex]
    const docNo = order.order_no
    const contact = orderContact(order)
    const batches = batchModal.map((r) => (r.na ? 'N/A' : r.batch.trim()))
    const docData = {
      type: 'Delivery Note', docNo, date: docDate,
      invoiceTo,
      deliver: splitContact(order.customer_snapshot?.deliver || '').address,
      contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options, pallets: noPallets ? 0 : pallets, showHazard, batches,
      deliveryCharge: parseFloat(deliveryCharge) || 0,
    }
    const { totals } = generateDispatchPDF(docData, lh, products, packaging, prices)
    const linesSnap = lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      const ppl = parseFloat(prices[`${c.product?.id}::${c.packaging?.id}`]) || 0
      const unitPrice = ppl * (c.vol || 0)
      return {
        productName: c.productName, pg: c.pg, un_number: c.un_number,
        hazard: c.hazard, psn: c.psn, packDesc: c.packDesc, packQty: c.packQty,
        adr_transport_cat: c.product?.adr_transport_cat || '', batch: batches[i],
        vol: c.totalVol, net: c.net, gross: c.gross,
        price_per_litre: ppl, unit_price: unitPrice, line_total: unitPrice * c.qty,
      }
    })
    const orderTotal = linesSnap.reduce((s, l) => s + (l.line_total || 0), 0)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('dispatch_notes').insert({
      doc_no: docNo, doc_type: 'Delivery Note', doc_date: docDate, order_id: id,
      letterhead_snapshot: lh, customer: invoiceTo, deliver: docData.deliver,
      lines_snapshot: linesSnap, totals: { ...totals, contact, order_total: orderTotal, delivery_charge: parseFloat(deliveryCharge) || 0 }, options, created_by: user?.id || null,
    })
    await supabase.from('orders').update({ status: 'Delivery Note Generated' }).eq('id', id)
    setOrder({ ...order, status: 'Delivery Note Generated' })
    const refreshed = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
    setDispatched(refreshed.data || [])
    setPallets('')
    setNoPallets(false)
    setBatchModal(null)
    setBusy(false)
    toast('Delivery note generated')
  }

  if (!order) return <div className="card"><div className="empty">Loading…</div></div>

  const totals = docTotals(lines, products, packaging)

  const orderTotal = lines.reduce((sum, l) => {
    const c = computeLine(l, products, packaging)
    const ppl = parseFloat(prices[`${c.product?.id}::${c.packaging?.id}`]) || 0
    return sum + ppl * (c.vol || 0) * c.qty
  }, 0)

  const labelTotal = labelPrice > 0
    ? lines.reduce((sum, l) => sum + labelCount(l, products, packaging) * labelPrice, 0)
    : 0

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>{order.order_no} <StatusBadge status={order.status} /></h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g btn-sm" onClick={printNote}>🖨 Print note</button>
            <button className="btn btn-g btn-sm" onClick={() => router.push('/')}>← Back to log</button>
          </div>
        </div>
        <div className="row c3">
          <Info label="Customer" value={order.customer_snapshot?.name} />
          <Info label="Customer Order Number" value={order.po_ref || '—'} />
          <Info label="Ordered" value={prettyDate(order.order_date)} />
        </div>
        <div className="row c2" style={{ marginTop: 4 }}>
          <div className="field"><label>Invoice to</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{splitContact(order.customer_snapshot?.details || '').address}</div></div>
          <div className="field"><label>Deliver to</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{splitContact(order.customer_snapshot?.deliver || '').address}</div>
            {contactLines(orderContact(order)).length > 0 && (
              <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit', marginTop: 6, fontSize: 12 }}>
                <b style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Contact</b>{'\n'}{contactLines(orderContact(order)).join('\n')}
              </div>
            )}
          </div>
        </div>
        {order.notes ? <p className="hint"><b>Notes:</b> {order.notes}</p> : null}
        {order.added_by ? <p className="hint">Order added by <b>{order.added_by}</b></p> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ alignSelf: 'center' }}>Status:</label>
          {STATUS_FLOW.map((s) => (
            <span key={s} className={'chip' + (order.status === s ? ' on' : '')} onClick={() => setStatus(s)}>{s}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="ttl">
          <h2>Products</h2>
          <button className="btn btn-g btn-sm" onClick={saveLines}>Save products</button>
        </div>
        <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} />
        <p className="hint">Totals: {fmt(totals.volume)} L · net {fmt(totals.net)} kg · gross {fmt(totals.gross)} kg</p>
      </div>

      {order.customer_id && (
        <div className="card">
          <div className="ttl"><h2>Pricing</h2></div>
          <table className="tbl">
            <thead><tr>
              <th>Product</th>
              <th>Packaging</th>
              <th style={{ textAlign: 'right', width: '12%' }}>£ / Litre</th>
              <th style={{ textAlign: 'right', width: '12%' }}>Unit price</th>
              <th style={{ textAlign: 'right', width: '6%' }}>Qty</th>
              <th style={{ textAlign: 'right', width: '12%' }}>Line total</th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const c = computeLine(l, products, packaging)
                if (!c.product) return null
                const priceKey = `${c.product.id}::${c.packaging?.id}`
                const ppl = parseFloat(prices[priceKey]) || 0
                const unitPrice = ppl * (c.vol || 0)
                const lineTotal = unitPrice * c.qty
                return (
                  <tr key={i}>
                    <td>{c.productName}</td>
                    <td>{c.packaging?.name || '—'}</td>
                    <td>
                      <input className="mono" style={{ textAlign: 'right' }}
                        value={prices[priceKey] ?? ''}
                        placeholder="0.0000"
                        onChange={(e) => setPrices((p) => ({ ...p, [priceKey]: e.target.value }))}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value) || 0
                          setPrices((p) => ({ ...p, [priceKey]: v }))
                          savePrice(c.product.id, c.packaging?.id, v)
                        }}
                      />
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{unitPrice > 0 ? `£${unitPrice.toFixed(2)}` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{c.qty}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: lineTotal > 0 ? 700 : 400 }}>{lineTotal > 0 ? `£${lineTotal.toFixed(2)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(() => {
            const delivery = parseFloat(deliveryCharge) || 0
            const vat = Math.round((orderTotal + labelTotal + delivery) * 0.20 * 100) / 100
            const grandTotal = orderTotal + labelTotal + delivery + vat
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Label price (£/label)</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 8, color: 'var(--muted)', fontSize: 13 }}>£</span>
                    <input className="mono" style={{ textAlign: 'right', paddingLeft: 20, width: 90 }}
                      value={labelPrice || ''} placeholder="0.0000"
                      onChange={(e) => setLabelPrice(parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Delivery charge (optional)</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 8, color: 'var(--muted)', fontSize: 13 }}>£</span>
                    <input className="mono" style={{ textAlign: 'right', paddingLeft: 20, width: 90 }}
                      value={deliveryCharge} placeholder="0.00"
                      onChange={(e) => setDeliveryCharge(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 8, minWidth: 220 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                    <span className="muted">Subtotal</span>
                    <span className="mono">{orderTotal > 0 ? `£${orderTotal.toFixed(2)}` : '—'}</span>
                  </div>
                  {labelTotal > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                      <span className="muted">Labels</span>
                      <span className="mono">£{labelTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {delivery > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                      <span className="muted">Delivery</span>
                      <span className="mono">£{delivery.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                    <span className="muted">VAT (20%)</span>
                    <span className="mono">{orderTotal > 0 || delivery > 0 ? `£${vat.toFixed(2)}` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 17, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                    <span>Grand total</span>
                    <span className="mono">{grandTotal > 0 ? `£${grandTotal.toFixed(2)}` : '—'}</span>
                  </div>
                </div>
              </div>
            )
          })()}
          {labelPrice > 0 && labelTotal > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Label charges — £{labelPrice.toFixed(4)}/label</div>
              <table className="tbl" style={{ marginBottom: 0 }}>
                <thead><tr>
                  <th>Product</th>
                  <th>Packaging</th>
                  <th style={{ textAlign: 'right', width: '10%' }}>Labels</th>
                  <th style={{ textAlign: 'right', width: '12%' }}>Label cost</th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = computeLine(l, products, packaging)
                    const count = labelCount(l, products, packaging)
                    if (!count) return null
                    return (
                      <tr key={i}>
                        <td>{c.productName}</td>
                        <td>{c.packaging?.name || '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{count}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>£{(count * labelPrice).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">Enter £ per litre — unit price and line total are calculated automatically. Prices are saved against this customer for future orders. Products marked with * attract a label charge — set the £/label rate above (pre-filled from customer settings).</p>
        </div>
      )}

      <div className="card">
        <div className="ttl"><h2>Create delivery note</h2></div>
        <div className="row c3">
          <div className="field"><label>Letterhead</label>
            <select value={lhIndex} onChange={(e) => setLhIndex(+e.target.value)}>
              {letterheads.map((l, i) => <option key={l.id} value={i}>{l.name} — {l.company}</option>)}
            </select></div>
          <div className="field"><label>Date</label>
            <input className="mono" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div className="field"><label>Number of pallets</label>
            <input
              className={'mono' + (palletsFlash ? ' flash-error' : '')}
              type="number" min="0" value={pallets}
              disabled={noPallets}
              onChange={(e) => { setPallets(e.target.value); setPalletsFlash(false) }}
              placeholder={noPallets ? 'no pallets' : 'required'} />
            <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={noPallets}
                onChange={(e) => { setNoPallets(e.target.checked); if (e.target.checked) { setPallets(''); setPalletsFlash(false) } }}
                style={{ width: 'auto', height: 15, accentColor: 'var(--accent)' }} />
              No pallets required
            </label>
          </div>
        </div>
        <div className="row c2" style={{ marginBottom: 10 }}>
          <div className="field"><label>Invoice To (on PDF)</label>
            <textarea value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} style={{ minHeight: 62 }} /></div>
          <div className="field"><label>Additional options / notes on the note</label>
            <textarea value={options} onChange={(e) => setOptions(e.target.value)} placeholder="e.g. tail-lift required, deliver before noon…" style={{ minHeight: 62 }} /></div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={showHazard} onChange={(e) => setShowHazard(e.target.checked)} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
            Include hazard summary on PDF
          </label>
        </div>
        <button className="btn btn-a" onClick={startDispatch}>Generate delivery note</button>
      </div>

      {dispatched.length > 0 && (
        <div className="card">
          <div className="ttl"><h2>Delivery notes on this order</h2></div>
          {dispatched.map((d) => (
            <div key={d.id} className="list-row">
              <div>
                <div className="ono">{d.doc_no}</div>
                <div className="meta">
                  {prettyDate(d.doc_date)} · gross {fmt(d.totals?.gross || 0)} kg
                  {d.totals?.pallets > 0 ? ` · ${d.totals.pallets} pallet(s)` : ''}
                  {` · ${d.letterhead_snapshot?.name}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-g btn-sm" onClick={() => reprintPDF(d)}>Re-download PDF</button>
                <button className="btn btn-g btn-sm" onClick={() => printOfficeCopy(d)}>Print office copy</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {batchModal && (
        <div className="modal-bg" onClick={() => !busy && setBatchModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Batch numbers</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>Enter the batch number for each product, or tick <b>Not Applicable</b>.</p>
            <div className="batch-list">
              {batchModal.map((r, i) => (
                <div key={i} className="batch-row">
                  <div className="batch-name">{r.name}</div>
                  <input
                    value={r.batch}
                    disabled={r.na}
                    placeholder={r.na ? 'Not applicable' : 'Batch number'}
                    onChange={(e) => setBatchRow(i, { batch: e.target.value })}
                  />
                  <label className="batch-na">
                    <input type="checkbox" checked={r.na} onChange={(e) => setBatchRow(i, { na: e.target.checked, batch: e.target.checked ? '' : r.batch })} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                    Not Applicable
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => setBatchModal(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-a" onClick={confirmDispatch} disabled={busy}>{busy ? 'Generating…' : 'Generate delivery note'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }) {
  return <div className="field"><label>{label}</label><div className="mono" style={{ paddingTop: 4 }}>{value || '—'}</div></div>
}

function contactLines(contact) {
  if (!contact) return []
  const out = []
  if (contact.name) out.push(contact.name)
  if (contact.phone) out.push('Tel: ' + contact.phone)
  if (contact.email) out.push(contact.email)
  return out
}

// Contact for an order: use the stored snapshot contact if present,
// otherwise extract it from the address text (older orders embed it there).
function orderContact(order) {
  const c = order?.customer_snapshot?.contact
  if (c && (c.name || c.email || c.phone)) return c
  const fromDetails = splitContact(order?.customer_snapshot?.details || '').contact
  const fromDeliver = splitContact(order?.customer_snapshot?.deliver || '').contact
  const merged = {
    name: fromDetails.name || fromDeliver.name,
    email: fromDetails.email || fromDeliver.email,
    phone: fromDetails.phone || fromDeliver.phone,
  }
  return (merged.name || merged.email || merged.phone) ? merged : null
}

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900)
}
