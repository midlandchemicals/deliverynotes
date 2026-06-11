'use client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeLine, docTotals, fmt, prettyDate } from '@/lib/calc'

function hexToRgb(h) {
  const m = (h || '#197B55').replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

// Build hazard groups — exclude non-hazardous (key === '—')
function hazardGroups(lines, products, packaging) {
  const map = {}
  lines.forEach((l) => {
    const c = computeLine(l, products, packaging)
    const key = c.hazard || '—'
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0 }
    map[key].vol += c.totalVol; map[key].net += c.net; map[key].gross += c.gross
  })
  return map
}

function hazardGroupsFromSnap(snap) {
  const map = {}
  ;(snap || []).forEach((s) => {
    const key = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0 }
    map[key].vol += s.vol || 0; map[key].net += s.net || 0; map[key].gross += s.gross || 0
  })
  return map
}

// Compact bordered text box — NOT a full-width table
function drawHazardBox(doc, startY, groups, r, g, b, M) {
  const entries = Object.entries(groups)
  if (!entries.length) return startY

  const boxW = 120
  const lhPx = 5
  // count lines per entry: 2 text lines + 1 divider (except last)
  const totalLines = entries.length * 2 + Math.max(0, entries.length - 1)
  const boxH = 9 + totalLines * lhPx

  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(r, g, b)
  doc.text('HAZARDOUS GOODS SUMMARY', M, startY)
  startY += 3

  doc.setDrawColor(r, g, b).setLineWidth(0.5)
  doc.setFillColor(248, 252, 250)
  doc.roundedRect(M, startY, boxW, boxH, 2, 2, 'FD')

  let ty = startY + 7
  entries.forEach(([hazard, v], i) => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(20, 20, 20)
    doc.text(hazard, M + 4, ty); ty += lhPx
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(50, 50, 50)
    doc.text(`Vol: ${fmt(v.vol)} L  ·  Net: ${fmt(v.net)} kg  ·  Gross: ${fmt(v.gross)} kg`, M + 4, ty)
    ty += lhPx
    if (i < entries.length - 1) {
      doc.setDrawColor(200, 218, 210).setLineWidth(0.15).line(M + 2, ty, M + boxW - 2, ty)
      ty += lhPx
    }
  })

  return startY + boxH + 5
}

// Signature lines — three equal fields
function drawSigLines(doc, y, r, g, b, W, M) {
  const labels = ['Customer name', 'Print name', 'Date']
  const fw = 54, gap = 4
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(80, 80, 80)
  labels.forEach((label, i) => {
    const sx = M + i * (fw + gap)
    doc.text(label, sx, y)
    doc.setDrawColor(r, g, b).setLineWidth(0.4).line(sx, y + 7, sx + fw, y + 7)
  })
  return y + 12
}

// doc_ = { docNo, date, customer, deliver, lines, options, pallets, showHazard }
// lh   = { company, address, footer, color, logo }
export function generateDispatchPDF(doc_, lh, products, packaging) {
  const [r, g, b] = hexToRgb(lh.color)
  const t = docTotals(doc_.lines, products, packaging)
  const pallets = Math.max(0, parseInt(doc_.pallets || 0, 10) || 0)
  const showHazard = doc_.showHazard !== false
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 16
  let y = 16

  // ── Logo ──────────────────────────────────────────────────────────────────
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

  // ── Company ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
  const addrLines = String(lh.address || '').split('\n')
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90, 90, 90)
    .text(addrLines, M, y + 7)

  // ── DELIVERY NOTE title (right side) ──────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(r, g, b)
    .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
  doc.text(`No.   ${doc_.docNo || ''}`, W - M, 28, { align: 'right' })
  doc.text(`Date  ${prettyDate(doc_.date)}`, W - M, 34, { align: 'right' })

  // ── Coloured bar — max 4 inches from top (≈ 40mm for typical letterhead) ──
  const barY = Math.max(y + addrLines.length * 3.4 + 5, 38)
  doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.2, 'F')
  let cy = barY + 7
  const colW = (W - 2 * M - 5) / 2

  // ── Customer + Deliver blocks ─────────────────────────────────────────────
  function block(x, title, text) {
    doc.setDrawColor(r, g, b).setLineWidth(0.25)
    const bLines = doc.splitTextToSize(text || '', colW - 6)
    const h = 7 + bLines.length * 3.5
    doc.roundedRect(x, cy, colW, h, 1.5, 1.5, 'S')
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(r, g, b).text(title.toUpperCase(), x + 3, cy + 5)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(25, 25, 25).text(bLines, x + 3, cy + 10)
    return h
  }
  const bh1 = block(M, 'Customer', doc_.customer)
  const bh2 = block(M + colW + 5, 'Deliver to', doc_.deliver)
  cy += Math.max(bh1, bh2) + 5

  // ── Line items table ──────────────────────────────────────────────────────
  // Product and packaging merged into one column for readability
  autoTable(doc, {
    startY: cy,
    margin: { left: M, right: M },
    head: [['#', 'Product', 'Hazard / UN', 'Net (kg)', 'Gross (kg)']],
    body: doc_.lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      const desc = c.packaging?.name ? `${c.productName} — ${c.qty} x ${c.packaging.name}` : c.productName
      return [i + 1, desc, c.hazard, fmt(c.net), fmt(c.gross)]
    }),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5, lineColor: [210, 220, 215], lineWidth: 0.15 },
    headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      2: { cellWidth: 36 },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [242, 249, 245] },
  })

  // ── Totals ────────────────────────────────────────────────────────────────
  let ty = doc.lastAutoTable.finalY + 5
  const tx = W - M - 78
  const totRows = [
    { label: 'Total volume',       val: fmt(t.volume) + ' L',   bold: false },
    { label: 'Total net weight',   val: fmt(t.net) + ' kg',     bold: false },
    { label: 'Total gross weight', val: fmt(t.gross) + ' kg',   bold: true  },
  ]
  if (pallets > 0) totRows.push({ label: 'Total pallets', val: String(pallets), bold: true })
  totRows.forEach(({ label, val, bold }) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
    doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
  })

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (doc_.options) {
    ty += 3
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(40, 40, 40)
      .text(doc.splitTextToSize(doc_.options, W - 2 * M), M, ty + 5)
    ty += 5 + doc.splitTextToSize(doc_.options, W - 2 * M).length * 4.5 + 3
  }

  // ── Hazard summary box (optional) ─────────────────────────────────────────
  if (showHazard) {
    ty += 4
    const groups = hazardGroups(doc_.lines, products, packaging)
    ty = drawHazardBox(doc, ty, groups, r, g, b, M)
  }

  // ── Footer (fixed) ────────────────────────────────────────────────────────
  const fy = 287

  // ── Signature lines — always pinned directly above the footer ─────────────
  drawSigLines(doc, fy - 22, r, g, b, W, M)
  doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
    .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

  const safe = String(doc_.docNo || 'document').replace(/[^a-z0-9\-_]/gi, '_')
  doc.save(`${safe}.pdf`)
  return { totals: { ...t, pallets, showHazard } }
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
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
    const addrLines = String(lh.address || '').split('\n')
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90, 90, 90).text(addrLines, M, y + 7)

    // ── Title ────────────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(r, g, b)
      .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
    doc.text(`No.   ${d.doc_no}`, W - M, 28, { align: 'right' })
    doc.text(`Date  ${d.doc_date || ''}`, W - M, 34, { align: 'right' })

    const barY = Math.max(y + 7 + addrLines.length * 3.4 + 5, 38)
    doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.2, 'F')
    let cy = barY + 7
    const colW = (W - 2 * M - 5) / 2

    function block(x, title, text) {
      doc.setDrawColor(r, g, b).setLineWidth(0.25)
      const bLines = doc.splitTextToSize(text || '', colW - 6)
      const h = 7 + bLines.length * 3.5
      doc.roundedRect(x, cy, colW, h, 1.5, 1.5, 'S')
      doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(r, g, b).text(title.toUpperCase(), x + 3, cy + 5)
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(25, 25, 25).text(bLines, x + 3, cy + 10)
      return h
    }
    const bh1 = block(M, 'Customer', d.customer)
    const bh2 = block(M + colW + 5, 'Deliver to', d.deliver)
    cy += Math.max(bh1, bh2) + 5

    // ── Table ────────────────────────────────────────────────────────────────
    autoTable(doc, {
      startY: cy, margin: { left: M, right: M },
      head: [['#', 'Product', 'Hazard / UN', 'Net (kg)', 'Gross (kg)']],
      body: (d.lines_snapshot || []).map((s, i) => {
        const hazard = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
        // Use stored packDesc; format as "Name — N x Pack" if it has the old "N × Pack" style
        const packInfo = s.packDesc ? s.packDesc.replace('×', 'x') : ''
        const desc = packInfo ? `${s.productName} — ${packInfo}` : s.productName
        return [i + 1, desc, hazard, n2(s.net), n2(s.gross)]
      }),
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5, lineColor: [210, 220, 215], lineWidth: 0.15 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 36 },
        3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' },
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
    if (pallets > 0) totRows.push({ label: 'Total pallets', val: String(pallets), bold: true })
    totRows.forEach(({ label, val, bold }) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
      doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
    })

    // ── Notes ────────────────────────────────────────────────────────────────
    if (d.options) {
      ty += 3
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(40, 40, 40)
        .text(doc.splitTextToSize(d.options, W - 2 * M), M, ty + 5)
      ty += 5 + doc.splitTextToSize(d.options, W - 2 * M).length * 4.5 + 3
    }

    // ── Hazard box ───────────────────────────────────────────────────────────
    if (showHazard) {
      ty += 4
      const groups = hazardGroupsFromSnap(d.lines_snapshot)
      const entries = Object.entries(groups)
      if (entries.length) {
        const lhPx = 5
        const totalLines = entries.length * 2 + Math.max(0, entries.length - 1)
        const boxH = 9 + totalLines * lhPx
        const boxW = 120

        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(r, g, b)
        doc.text('HAZARDOUS GOODS SUMMARY', M, ty); ty += 3

        doc.setDrawColor(r, g, b).setLineWidth(0.5).setFillColor(248, 252, 250)
        doc.roundedRect(M, ty, boxW, boxH, 2, 2, 'FD')

        let bty = ty + 7
        entries.forEach(([hazard, v], idx) => {
          doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(20, 20, 20)
          doc.text(hazard, M + 4, bty); bty += lhPx
          doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(50, 50, 50)
          const volStr = v.vol > 0 ? n2(v.vol) + ' L' : '—'
          doc.text(`Vol: ${volStr}  ·  Net: ${n2(v.net)} kg  ·  Gross: ${n2(v.gross)} kg`, M + 4, bty)
          bty += lhPx
          if (idx < entries.length - 1) {
            doc.setDrawColor(200, 218, 210).setLineWidth(0.15).line(M + 2, bty, M + boxW - 2, bty)
            bty += lhPx
          }
        })
        ty = ty + boxH + 5
      }
    }

    // ── Sig lines (fixed above footer) ──────────────────────────────────────
    const fy = 287
    drawSigLines(doc, fy - 22, r, g, b, W, M)

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
      .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

    doc.save(`${String(d.doc_no).replace(/[^a-z0-9\-_]/gi, '_')}.pdf`)
  }))
}
