'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, nextNo } from '@/lib/calc'
import { generateDispatchPDF } from '@/lib/pdf'
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
  const [docNo, setDocNo] = useState('')
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [options, setOptions] = useState('')

  useEffect(() => {
    (async () => {
      const [o, p, k, lh] = await Promise.all([
        supabase.from('orders').select('*').eq('id', id).single(),
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
        supabase.from('letterheads').select('*').order('name'),
      ])
      setOrder(o.data); setProducts(p.data || []); setPackaging(k.data || []); setLetterheads(lh.data || [])
      setLines(o.data?.lines || [])
      setDocNo((o.data?.order_no || 'DN-1001').replace(/^ORD/, 'DN'))
      const dn = await supabase.from('dispatch_notes').select('doc_no').order('created_at', { ascending: false }).limit(1)
      if (dn.data?.[0]?.doc_no) setDocNo(nextNo(dn.data[0].doc_no))
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
    toast('Order lines saved')
  }

  async function createDispatch() {
    const lh = letterheads[lhIndex]
    if (!lh) { alert('Add a letterhead first (Letterheads tab).'); return }
    const docData = {
      type: 'Delivery Note', docNo, date: docDate,
      customer: order.customer_snapshot?.details || '',
      deliver: order.customer_snapshot?.deliver || '',
      lines, options,
    }
    const { totals } = generateDispatchPDF(docData, lh, products, packaging)
    const linesSnap = lines.map((l) => {
      const c = computeLine(l, products, packaging)
      return { productName: c.productName, pg: c.pg, un_number: c.un_number, hazard: c.hazard, packDesc: c.packDesc, net: c.net, gross: c.gross }
    })
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('dispatch_notes').insert({
      doc_no: docNo, doc_type: 'Delivery Note', doc_date: docDate, order_id: id,
      letterhead_snapshot: lh, customer: docData.customer, deliver: docData.deliver,
      lines_snapshot: linesSnap, totals, options, created_by: user?.id || null,
    })
    await supabase.from('orders').update({ status: 'Delivery Note Generated' }).eq('id', id)
    setOrder({ ...order, status: 'Delivery Note Generated' })
    const refreshed = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
    setDispatched(refreshed.data || [])
    setDocNo(nextNo(docNo))
    toast('Delivery note generated')
  }

  if (!order) return <div className="card"><div className="empty">Loading…</div></div>

  const totals = docTotals(lines, products, packaging)

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>{order.order_no} <StatusBadge status={order.status} /></h2>
          <button className="btn btn-g btn-sm" onClick={() => router.push('/')}>← Back to log</button>
        </div>
        <div className="row c3">
          <Info label="Customer" value={order.customer_snapshot?.name} />
          <Info label="Customer Order Number" value={order.po_ref || '—'} />
          <Info label="Ordered" value={prettyDate(order.order_date)} />
        </div>
        <div className="row c2" style={{ marginTop: 4 }}>
          <div className="field"><label>Customer</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{order.customer_snapshot?.details}</div></div>
          <div className="field"><label>Deliver to</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{order.customer_snapshot?.deliver}</div></div>
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
          <h2>Lines</h2>
          <button className="btn btn-g btn-sm" onClick={saveLines}>Save line edits</button>
        </div>
        <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} />
        <p className="hint">Totals: {totals.packages} packages · {fmt(totals.volume)} L · net {fmt(totals.net)} kg · gross {fmt(totals.gross)} kg</p>
      </div>

      <div className="card">
        <div className="ttl"><h2>Create delivery note</h2></div>
        <div className="row c3">
          <div className="field"><label>Letterhead</label>
            <select value={lhIndex} onChange={(e) => setLhIndex(+e.target.value)}>
              {letterheads.map((l, i) => <option key={l.id} value={i}>{l.name} — {l.company}</option>)}
            </select></div>
          <div className="field"><label>Doc no.</label>
            <input className="mono" value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
          <div className="field"><label>Date</label>
            <input className="mono" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Additional options / notes on the note</label>
            <textarea value={options} onChange={(e) => setOptions(e.target.value)} placeholder="e.g. tail-lift required, deliver before noon…" style={{ minHeight: 46 }} /></div>
        </div>
        <button className="btn btn-a" onClick={createDispatch}>Generate delivery note</button>
      </div>

      {dispatched.length > 0 && (
        <div className="card">
          <div className="ttl"><h2>Delivery notes on this order</h2></div>
          {dispatched.map((d) => (
            <div key={d.id} className="list-row">
              <div>
                <div className="ono">{d.doc_no}</div>
                <div className="meta">{prettyDate(d.doc_date)} · gross {fmt(d.totals?.gross || 0)} kg · {d.letterhead_snapshot?.name}</div>
              </div>
              <button className="btn btn-g btn-sm" onClick={() => reprint(d)}>Re-download PDF</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Re-download a previously generated note straight from its stored snapshot,
// so it stays identical even if products/packaging are edited later.
function reprint(d) {
  import('jspdf').then(({ jsPDF }) => import('jspdf-autotable').then((mod) => {
    const autoTable = mod.default
    const lh = d.letterhead_snapshot || {}
    const m = (lh.color || '#0a6b61').replace('#', '')
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16)
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210, M = 16
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20, 20, 20).text(lh.company || '', M, 20)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90, 90, 90).text(String(lh.address || '').split('\n'), M, 26)
    doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(r, g, b).text('DELIVERY NOTE', W - M, 22, { align: 'right' })
    doc.setFont('courier', 'normal').setFontSize(9).setTextColor(40, 40, 40)
    doc.text(`No.   ${d.doc_no}`, W - M, 29, { align: 'right' })
    doc.text(`Date  ${(d.doc_date || '')}`, W - M, 34, { align: 'right' })
    const barY = Math.max(26 + String(lh.address || '').split('\n').length * 4 + 6, 44)
    doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.4, 'F')
    let cy = barY + 9
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(130, 130, 130).text('CUSTOMER', M, cy)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(30, 30, 30).text(doc.splitTextToSize(d.customer || '', 80), M, cy + 5)
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(130, 130, 130).text('DELIVER TO', W / 2, cy)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(30, 30, 30).text(doc.splitTextToSize(d.deliver || '', 80), W / 2, cy + 5)
    cy += 30
    autoTable(doc, {
      startY: cy, margin: { left: M, right: M },
      head: [['#', 'Product', 'Hazard / UN', 'Packaging', 'Net (kg)', 'Gross (kg)']],
      body: (d.lines_snapshot || []).map((s, i) => {
        const hazard = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
        return [i + 1, s.productName, hazard, s.packDesc, num2(s.net), num2(s.gross)]
      }),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.4 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontSize: 8 },
      alternateRowStyles: { fillColor: [247, 244, 236] },
    })
    let ty = doc.lastAutoTable.finalY + 6
    const t = d.totals || {}
    ;[['Total packages', String(t.packages || 0)], ['Total net weight', num2(t.net) + ' kg'], ['Total gross weight', num2(t.gross) + ' kg']]
      .forEach(([k, v]) => { doc.setFont('courier', 'normal').setFontSize(9.5).text(k, W - M - 70, ty); doc.text(v, W - M, ty, { align: 'right' }); ty += 5.5 })
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120, 120, 120).text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, 287, { align: 'center' })
    doc.save(`${String(d.doc_no).replace(/[^a-z0-9\-_]/gi, '_')}.pdf`)
  }))
}
function num2(n) { return (Math.round((n || 0) * 100) / 100).toLocaleString() }

function Info({ label, value }) {
  return <div className="field"><label>{label}</label><div className="mono" style={{ paddingTop: 4 }}>{value || '—'}</div></div>
}

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900)
}
