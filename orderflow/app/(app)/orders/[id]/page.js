'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, splitContact } from '@/lib/calc'
import { generateDispatchPDF, reprintPDF } from '@/lib/pdf'
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
    }
    const { totals } = generateDispatchPDF(docData, lh, products, packaging)
    const linesSnap = lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      return {
        productName: c.productName, pg: c.pg, un_number: c.un_number,
        hazard: c.hazard, packDesc: c.packDesc, batch: batches[i],
        vol: c.totalVol, net: c.net, gross: c.gross,
      }
    })
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('dispatch_notes').insert({
      doc_no: docNo, doc_type: 'Delivery Note', doc_date: docDate, order_id: id,
      letterhead_snapshot: lh, customer: invoiceTo, deliver: docData.deliver,
      lines_snapshot: linesSnap, totals: { ...totals, contact }, options, created_by: user?.id || null,
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
              <button className="btn btn-g btn-sm" onClick={() => reprintPDF(d)}>Re-download PDF</button>
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
