'use client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeLine, docTotals, fmt, prettyDate, packSize } from '@/lib/calc'
import { registerFonts } from '@/lib/fonts'

// Typeface used throughout the PDF — matches the web app (Plus Jakarta Sans).
// registerFonts() sets this to 'PlusJakarta', or falls back to 'helvetica'.
let FONT = 'helvetica'

function hexToRgb(h) {
  const m = (h || '#197B55').replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

// Join consecutive short address lines so addresses read across rather than down.
// "Farthing Road\nIpswich\nIP1 5AP" → "Farthing Road, Ipswich, IP1 5AP"
function compactAddress(text, maxLen = 52) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const out = []
  let cur = ''
  for (const line of lines) {
    if (!cur) { cur = line }
    else if ((cur + ', ' + line).length <= maxLen) { cur += ', ' + line }
    else { out.push(cur); cur = line }
  }
  if (cur) out.push(cur)
  return out.join('\n')
}

// Build hazard groups — exclude non-hazardous (key === '—')
function hazardGroups(lines, products, packaging) {
  const map = {}
  lines.forEach((l) => {
    const c = computeLine(l, products, packaging)
    const key = c.hazard || '—'
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0, psn: c.psn || '', tc: c.product?.adr_transport_cat || '' }
    map[key].vol += c.totalVol; map[key].net += c.net; map[key].gross += c.gross
  })
  return map
}

function hazardGroupsFromSnap(snap) {
  const map = {}
  ;(snap || []).forEach((s) => {
    const key = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0, psn: s.psn || '', tc: s.adr_transport_cat || '' }
    map[key].vol += s.vol || 0; map[key].net += s.net || 0; map[key].gross += s.gross || 0
  })
  return map
}

// Lay out a sequence of styled text segments with word-level wrapping.
// parts = [{ text, bold, color }]. Returns { lines, endY }.
function flowText(doc, x, y, maxW, fontSize, parts, lineH, measure) {
  let cx = x, cy = y, lines = 1
  doc.setFontSize(fontSize)
  const spaceW = doc.getTextWidth(' ')
  parts.forEach((part) => {
    doc.setFont(FONT, part.bold ? 'bold' : 'normal')
    if (!measure) doc.setTextColor(...(part.color || [25, 25, 25]))
    const tokens = String(part.text).match(/\S+|\s+/g) || []
    tokens.forEach((tk) => {
      if (/^\s+$/.test(tk)) { if (cx > x) cx += spaceW; return }
      const ww = doc.getTextWidth(tk)
      if (cx + ww > x + maxW && cx > x) { cy += lineH; cx = x; lines++ }
      if (!measure) doc.text(tk, cx, cy)
      cx += ww
    })
  })
  return { lines, endY: cy }
}

// Full-width hazard summary — one flowing line per substance
function drawHazardBox(doc, startY, groups, r, g, b, M, W) {
  const entries = Object.entries(groups)
  if (!entries.length) return startY

  const boxW = W - 2 * M
  const innerW = boxW - 8
  const fontSize = 8
  const lineH = 3.5
  const entryGap = 1.8

  const segmentsFor = (hazard, v) => {
    const tcStr = v.tc ? `   Transport cat. ${v.tc}` : ''
    const weights = (v.vol > 0 ? `Vol: ${fmt(v.vol)} L · ` : '') + `Net: ${fmt(v.net)} kg · Gross: ${fmt(v.gross)} kg` + tcStr
    return [
      { text: hazard + '   ', bold: true, color: [20, 20, 20] },
      ...(v.psn ? [{ text: v.psn + '   ', bold: false, color: [60, 60, 60] }] : []),
      { text: weights, bold: false, color: [90, 90, 90] },
    ]
  }

  // Measure total height first
  let contentH = 0
  const measured = entries.map(([hazard, v]) => {
    const parts = segmentsFor(hazard, v)
    const m = flowText(doc, M + 4, 0, innerW, fontSize, parts, lineH, true)
    contentH += m.lines * lineH + entryGap
    return { parts, lines: m.lines }
  })
  const boxH = 5 + contentH

  // Never collide with the signature block — overflow to a new page
  if (startY + 3 + boxH > 258) { doc.addPage(); startY = 20 }

  doc.setFont(FONT, 'bold').setFontSize(8).setTextColor(r, g, b)
  doc.text('HAZARDOUS GOODS SUMMARY', M, startY)
  startY += 3

  doc.setDrawColor(r, g, b).setLineWidth(0.5).setFillColor(248, 252, 250)
  doc.roundedRect(M, startY, boxW, boxH, 2, 2, 'FD')

  let ty = startY + 5
  measured.forEach(({ parts, lines }) => {
    flowText(doc, M + 4, ty, innerW, fontSize, parts, lineH, false)
    ty += lines * lineH + entryGap
  })

  return startY + boxH + 5
}

// Signature lines — three equal fields
function drawSigLines(doc, y, r, g, b, W, M) {
  const labels = ['Customer name', 'Print name', 'Date']
  const fw = 54, gap = 4
  doc.setFont(FONT, 'normal').setFontSize(8.5).setTextColor(80, 80, 80)
  labels.forEach((label, i) => {
    const sx = M + i * (fw + gap)
    doc.text(label, sx, y)
    doc.setDrawColor(r, g, b).setLineWidth(0.4).line(sx, y + 7, sx + fw, y + 7)
  })
  return y + 12
}

function dnFilename(dateStr, docNo, customerName) {
  const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00')
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  const safeNo = String(docNo || 'DN').replace(/[^a-z0-9\-_]/gi, '_')
  const safeName = (customerName || 'customer').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()
  return `${dd}${mm}${yy}_${safeNo}_${safeName}.pdf`
}

function contactPdfLines(c) {
  if (!c) return []
  const out = []
  if (c.name) out.push(c.name)
  if (c.phone) out.push('Tel: ' + c.phone)
  if (c.email) out.push(c.email)
  return out
}

// doc_ = { docNo, date, invoiceTo, deliver, contact, customerName, lines, batches, options, pallets, showHazard }
// lh   = { company, address, footer, color, logo }
export function generateDispatchPDF(doc_, lh, products, packaging) {
  const [r, g, b] = hexToRgb(lh.color)
  const t = docTotals(doc_.lines, products, packaging)
  const pallets = Math.max(0, parseInt(doc_.pallets || 0, 10) || 0)
  const showHazard = doc_.showHazard !== false
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  FONT = registerFonts(doc)
  const W = 210, M = 16
  let y = 16

  // ── Logo ──────────────────────────────────────────────────────────────────
  if (lh.logo) {
    try {
      const props = doc.getImageProperties(lh.logo)
      const maxW = 40, maxH = 14
      let lw = maxW
      let logoH = (lw * props.height) / props.width
      if (logoH > maxH) { logoH = maxH; lw = (logoH * props.width) / props.height }
      const imgFmt = (lh.logo.match(/data:image\/(\w+)/) || [])[1]?.toUpperCase() || 'PNG'
      doc.addImage(lh.logo, imgFmt, M, y, lw, logoH); y += logoH + 2
    } catch (e) {}
  }

  // ── Company ───────────────────────────────────────────────────────────────
  doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
  const addrLines = String(lh.address || '').split('\n')
  doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(90, 90, 90)
    .text(addrLines, M, y + 7)

  // ── DELIVERY NOTE title (right side) ──────────────────────────────────────
  doc.setFont(FONT, 'bold').setFontSize(22).setTextColor(r, g, b)
    .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
  doc.setFont(FONT, 'normal').setFontSize(10).setTextColor(40, 40, 40)
  doc.text(`No.   ${doc_.docNo || ''}`, W - M, 28, { align: 'right' })
  doc.text(`Date  ${prettyDate(doc_.date)}`, W - M, 34, { align: 'right' })

  // ── Coloured bar — max 4 inches from top (≈ 40mm for typical letterhead) ──
  const barY = Math.max(y + addrLines.length * 3.4 + 5, 38)
  doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.2, 'F')
  let cy = barY + 7
  const colW = (W - 2 * M - 5) / 2

  // ── Invoice To + Deliver To (+ contact) blocks ────────────────────────────
  // Generous inner padding so the boxes don't crowd the text
  function block(x, title, text, yPos = cy) {
    doc.setDrawColor(r, g, b).setLineWidth(0.25)
    const bLines = doc.splitTextToSize(compactAddress(text || ''), colW - 10)
    const h = 11 + bLines.length * 3.9
    doc.roundedRect(x, yPos, colW, h, 2, 2, 'S')
    doc.setFont(FONT, 'bold').setFontSize(7).setTextColor(r, g, b).text(title.toUpperCase(), x + 5, yPos + 5.5)
    doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(25, 25, 25)
      .text(bLines, x + 5, yPos + 10.5, { lineHeightFactor: 1.25 })
    return h
  }
  const rightX = M + colW + 5
  const bh1 = block(M, 'Invoice To', doc_.invoiceTo)
  const bh2 = block(rightX, 'Deliver To', doc_.deliver)
  let rightH = bh2
  const cLines = contactPdfLines(doc_.contact)
  if (cLines.length) {
    const cbh = block(rightX, 'Contact', cLines.join('\n'), cy + bh2 + 3)
    rightH = bh2 + 3 + cbh
  }
  cy += Math.max(bh1, rightH) + 5

  // ── Line items table ──────────────────────────────────────────────────────
  // Quantity gets its own column ahead of the product name
  autoTable(doc, {
    startY: cy,
    // bottom margin keeps table rows clear of the pinned signature block
    margin: { left: M, right: M, bottom: 45 },
    head: [['Batch', 'Qty', 'Product', 'UN / PG', 'Net (kg)', 'Gross (kg)']],
    body: doc_.lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      return [(doc_.batches && doc_.batches[i]) || '', c.packQty, c.productName, c.hazardShort, fmt(c.net), fmt(c.gross)]
    }),
    styles: { font: FONT, fontSize: 9, cellPadding: 1.6, lineColor: [210, 220, 215], lineWidth: 0.15 },
    headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 18 },
      3: { cellWidth: 26 },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [242, 249, 245] },
  })

  // ── Totals ────────────────────────────────────────────────────────────────
  // Each pallet adds 20 kg to the gross weight
  const palletKg = pallets * 20
  const grossTotal = t.gross + palletKg
  let ty = doc.lastAutoTable.finalY + 5
  const tx = W - M - 78
  const totRows = [
    { label: 'Total volume',       val: fmt(t.volume) + ' L',     bold: false },
    { label: 'Total net weight',   val: fmt(t.net) + ' kg',       bold: false },
    { label: 'Total gross weight', val: fmt(grossTotal) + ' kg',  bold: true  },
  ]
  if (pallets > 0) totRows.push({ label: 'Total pallets', val: String(pallets), bold: true })
  if (ty + totRows.length * 6 > 258) { doc.addPage(); ty = 20 }
  totRows.forEach(({ label, val, bold }) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
    doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
  })

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (doc_.options) {
    ty += 3
    const noteLines = doc.splitTextToSize(doc_.options, W - 2 * M)
    if (ty + 5 + noteLines.length * 4.5 > 258) { doc.addPage(); ty = 20 }
    doc.setFont(FONT, 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
    doc.setFont(FONT, 'normal').setFontSize(9.5).setTextColor(40, 40, 40)
      .text(noteLines, M, ty + 5)
    ty += 5 + noteLines.length * 4.5 + 3
  }

  // ── Hazard summary box (optional) ─────────────────────────────────────────
  if (showHazard) {
    ty += 4
    const groups = hazardGroups(doc_.lines, products, packaging)
    ty = drawHazardBox(doc, ty, groups, r, g, b, M, W)
  }

  // ── Footer (fixed) ────────────────────────────────────────────────────────
  const fy = 287

  // ── Signature lines — always pinned directly above the footer ─────────────
  drawSigLines(doc, fy - 22, r, g, b, W, M)
  doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
  doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
    .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

  const custName = doc_.customerName || (doc_.customer || '').split('\n')[0]
  window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
  // Stored gross includes pallet weight so the log and reprints match the PDF
  return { totals: { ...t, gross: grossTotal, pallets, showHazard, invoice_to: doc_.invoiceTo || '' } }
}


// ── Reprint from stored snapshot ────────────────────────────────────────────
export function reprintPDF(d) {
  import('jspdf').then(({ jsPDF }) => import('jspdf-autotable').then((mod) => {
    const autoTable = mod.default
    const lh = d.letterhead_snapshot || {}
    const [r, g, b] = (() => {
      const m = (lh.color || '#197B55').replace('#', '')
      return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
    })()
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    FONT = registerFonts(doc)
    const W = 210, M = 16
    const n2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
    let y = 16

    // ── Logo ─────────────────────────────────────────────────────────────────
    if (lh.logo) {
      try {
        const props = doc.getImageProperties(lh.logo)
        const maxW = 40, maxH = 14
        let lw = Math.min(maxW, props.width * 0.18)
        let logoH = (lw * props.height) / props.width
        if (logoH > maxH) { logoH = maxH; lw = (logoH * props.width) / props.height }
        const imgFmt = (lh.logo.match(/data:image\/(\w+)/) || [])[1]?.toUpperCase() || 'PNG'
        doc.addImage(lh.logo, imgFmt, M, y, lw, logoH); y += logoH + 2
      } catch (e) {}
    }

    // ── Company ──────────────────────────────────────────────────────────────
    doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
    const addrLines = String(lh.address || '').split('\n')
    doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(90, 90, 90).text(addrLines, M, y + 7)

    // ── Title ────────────────────────────────────────────────────────────────
    doc.setFont(FONT, 'bold').setFontSize(22).setTextColor(r, g, b)
      .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
    doc.setFont(FONT, 'normal').setFontSize(10).setTextColor(40, 40, 40)
    doc.text(`No.   ${d.doc_no}`, W - M, 28, { align: 'right' })
    doc.text(`Date  ${d.doc_date || ''}`, W - M, 34, { align: 'right' })

    const barY = Math.max(y + 7 + addrLines.length * 3.4 + 5, 38)
    doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.2, 'F')
    let cy = barY + 7
    const colW = (W - 2 * M - 5) / 2

    function block(x, title, text, yPos = cy) {
      doc.setDrawColor(r, g, b).setLineWidth(0.25)
      const bLines = doc.splitTextToSize(compactAddress(text || ''), colW - 10)
      const h = 11 + bLines.length * 3.9
      doc.roundedRect(x, yPos, colW, h, 2, 2, 'S')
      doc.setFont(FONT, 'bold').setFontSize(7).setTextColor(r, g, b).text(title.toUpperCase(), x + 5, yPos + 5.5)
      doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(25, 25, 25)
        .text(bLines, x + 5, yPos + 10.5, { lineHeightFactor: 1.25 })
      return h
    }
    const rightX = M + colW + 5
    const bh1 = block(M, 'Invoice To', d.customer)
    const bh2 = block(rightX, 'Deliver To', d.deliver)
    let rightH = bh2
    const cLines = contactPdfLines(d.totals?.contact)
    if (cLines.length) {
      const cbh = block(rightX, 'Contact', cLines.join('\n'), cy + bh2 + 3)
      rightH = bh2 + 3 + cbh
    }
    cy += Math.max(bh1, rightH) + 5

    // ── Table ────────────────────────────────────────────────────────────────
    autoTable(doc, {
      startY: cy, margin: { left: M, right: M, bottom: 45 },
      head: [['Batch', 'Qty', 'Product', 'UN / PG', 'Net (kg)', 'Gross (kg)']],
      body: (d.lines_snapshot || []).map((s) => {
        const pgNorm = String(s.pg || '').replace(/^PG\s*/i, '').trim()
        const hazardShort = s.un_number ? `${s.un_number}${pgNorm ? ` PG ${pgNorm}` : ''}` : (s.pg || '—')
        // Prefer the stored compact qty; fall back to parsing the old packDesc
        let packQty = s.packQty
        if (!packQty && s.packDesc) {
          const m = s.packDesc.match(/^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+)$/)
          packQty = m ? `${m[1]}x${packSize(m[2]) || m[2].trim()}` : s.packDesc.replace('×', 'x')
        }
        return [s.batch || '', packQty || '', s.productName, hazardShort, n2(s.net), n2(s.gross)]
      }),
      styles: { font: FONT, fontSize: 9, cellPadding: 1.6, lineColor: [210, 220, 215], lineWidth: 0.15 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 3: { cellWidth: 26 },
        4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [242, 249, 245] },
    })

    // ── Totals ───────────────────────────────────────────────────────────────
    const t = d.totals || {}
    const pallets = parseInt(t.pallets || 0, 10) || 0
    const showHazard = t.showHazard !== false
    let ty = doc.lastAutoTable.finalY + 5
    const tx = W - M - 78
    const totRows = [
      { label: 'Total volume',       val: n2(t.volume) + ' L',  bold: false },
      { label: 'Total net weight',   val: n2(t.net) + ' kg',    bold: false },
      { label: 'Total gross weight', val: n2(t.gross) + ' kg',  bold: true  },
    ]
    // Stored gross already includes pallet weight (20 kg each)
    if (pallets > 0) totRows.push({ label: 'Total pallets', val: String(pallets), bold: true })
    if (ty + totRows.length * 6 > 258) { doc.addPage(); ty = 20 }
    totRows.forEach(({ label, val, bold }) => {
      doc.setFont(FONT, bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
      doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
    })

    // ── Notes ────────────────────────────────────────────────────────────────
    if (d.options) {
      ty += 3
      const noteLines = doc.splitTextToSize(d.options, W - 2 * M)
      if (ty + 5 + noteLines.length * 4.5 > 258) { doc.addPage(); ty = 20 }
      doc.setFont(FONT, 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
      doc.setFont(FONT, 'normal').setFontSize(9.5).setTextColor(40, 40, 40)
        .text(noteLines, M, ty + 5)
      ty += 5 + noteLines.length * 4.5 + 3
    }

    // ── Hazard box ───────────────────────────────────────────────────────────
    if (showHazard) {
      ty += 4
      const groups = hazardGroupsFromSnap(d.lines_snapshot)
      ty = drawHazardBox(doc, ty, groups, r, g, b, M, W)
    }

    // ── Sig lines (fixed above footer) ──────────────────────────────────────
    const fy = 287
    drawSigLines(doc, fy - 22, r, g, b, W, M)

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
    doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
      .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

    window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
  }))
}
