'use client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeLine, docTotals, fmt, prettyDate } from '@/lib/calc'

function hexToRgb(h) {
  const m = (h || '#197B55').replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

// Build hazard groups from live lines (for new generation)
function hazardGroups(lines, products, packaging) {
  const map = {}
  lines.forEach((l) => {
    const c = computeLine(l, products, packaging)
    const key = c.hazard || '—'
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0 }
    map[key].vol += c.totalVol; map[key].net += c.net; map[key].gross += c.gross
  })
  return map
}

// Build hazard groups from stored snapshot (for reprint)
function hazardGroupsFromSnap(snap) {
  const map = {}
  ;(snap || []).forEach((s) => {
    const key = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0 }
    map[key].vol += s.vol || 0; map[key].net += s.net || 0; map[key].gross += s.gross || 0
  })
  return map
}

function drawHazardTable(doc, startY, groups, r, g, b, W, M) {
  const rows = Object.entries(groups).map(([hazard, v]) => [
    hazard,
    fmt(v.vol) + ' L',
    fmt(v.net) + ' kg',
    fmt(v.gross) + ' kg',
  ])
  autoTable(doc, {
    startY,
    margin: { left: M, right: M },
    head: [['Hazard / Packing Group', 'Total Volume', 'Total Net Weight', 'Total Gross Weight']],
    body: rows,
    styles: {
      font: 'helvetica', fontSize: 11, cellPadding: 4,
      lineColor: [r, g, b], lineWidth: 0.4,
    },
    headStyles: {
      fillColor: [r, g, b], textColor: [255, 255, 255],
      fontStyle: 'bold', fontSize: 10,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 65 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
    tableLineColor: [r, g, b],
    tableLineWidth: 0.5,
    alternateRowStyles: { fillColor: [240, 248, 244] },
  })
  return doc.lastAutoTable.finalY
}

// doc_ = { type, docNo, date, customer, deliver, lines, options, pallets }
// lh   = letterhead row { company, address, footer, color, logo }
export function generateDispatchPDF(doc_, lh, products, packaging) {
  const [r, g, b] = hexToRgb(lh.color)
  const t = docTotals(doc_.lines, products, packaging)
  const pallets = Math.max(0, parseInt(doc_.pallets || 0, 10) || 0)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 16
  let y = 18

  if (lh.logo) {
    try {
      const props = doc.getImageProperties(lh.logo)
      const w = Math.min(40, props.width * 0.18)
      const h = Math.min((w * props.height) / props.width, 20)
      doc.addImage(lh.logo, 'PNG', M, y, w, h); y += h + 2
    } catch (e) {}
  }
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90, 90, 90)
    .text(String(lh.address || '').split('\n'), M, y + 8)

  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(r, g, b)
    .text('DELIVERY NOTE', W - M, 22, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
  doc.text(`No.   ${doc_.docNo || ''}`, W - M, 30, { align: 'right' })
  doc.text(`Date  ${prettyDate(doc_.date)}`, W - M, 36, { align: 'right' })

  const barY = Math.max(y + String(lh.address || '').split('\n').length * 4 + 8, 46)
  doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.4, 'F')
  let cy = barY + 9
  const colW = (W - 2 * M - 6) / 2

  function block(x, title, text) {
    doc.setDrawColor(r, g, b).setLineWidth(0.25)
    const lines = doc.splitTextToSize(text || '', colW - 8)
    const h = 12 + lines.length * 5
    doc.roundedRect(x, cy, colW, h, 2, 2, 'S')
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(r, g, b).text(title.toUpperCase(), x + 4, cy + 6)
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(30, 30, 30).text(lines, x + 4, cy + 12)
    return h
  }
  const h1 = block(M, 'Customer', doc_.customer)
  const h2 = block(M + colW + 6, 'Deliver to', doc_.deliver)
  cy += Math.max(h1, h2) + 8

  autoTable(doc, {
    startY: cy,
    margin: { left: M, right: M },
    head: [['#', 'Product', 'Hazard / UN', 'Packaging', 'Net (kg)', 'Gross (kg)']],
    body: doc_.lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      return [i + 1, c.productName, c.hazard, c.packDesc, fmt(c.net), fmt(c.gross)]
    }),
    styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, lineColor: [210, 220, 215], lineWidth: 0.15 },
    headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      2: { cellWidth: 34 },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [240, 248, 244] },
  })

  let ty = doc.lastAutoTable.finalY + 7
  const tx = W - M - 80
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(40, 40, 40)
  const totRows = [
    ['Total volume', fmt(t.volume) + ' L'],
    ['Total net weight', fmt(t.net) + ' kg'],
    ['Total gross weight', fmt(t.gross) + ' kg'],
  ]
  if (pallets > 0) totRows.push(['Total pallets', String(pallets)])
  totRows.forEach(([k, v], i) => {
    if (i === totRows.length - 1) doc.setFont('helvetica', 'bold').setFontSize(13)
    doc.text(k, tx, ty); doc.text(v, W - M, ty, { align: 'right' }); ty += 6.5
  })

  if (doc_.options) {
    ty += 4
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110, 110, 110).text('NOTES', M, ty)
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
      .text(doc.splitTextToSize(doc_.options, W - 2 * M), M, ty + 6)
    ty += 6 + doc.splitTextToSize(doc_.options, W - 2 * M).length * 5 + 4
  }

  ty += 6
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(r, g, b)
    .text('HAZARDOUS GOODS SUMMARY', M, ty)
  ty += 4
  const groups = hazardGroups(doc_.lines, products, packaging)
  drawHazardTable(doc, ty, groups, r, g, b, W, M)
  const afterHazard = doc.lastAutoTable.finalY

  const fy = 287
  if (afterHazard < fy - 10) {
    doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130, 130, 130)
      .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })
  }

  const safe = String(doc_.docNo || 'document').replace(/[^a-z0-9\-_]/gi, '_')
  doc.save(`${safe}.pdf`)
  return { totals: { ...t, pallets } }
}


// ── reprint helper (called from order detail page) ──────────────────────────
// All drawing logic is duplicated here so old snapshots stay identical.
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

    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20, 20, 20).text(lh.company || '', M, 20)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90, 90, 90)
      .text(String(lh.address || '').split('\n'), M, 26)
    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(r, g, b)
      .text('DELIVERY NOTE', W - M, 22, { align: 'right' })
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
    doc.text(`No.   ${d.doc_no}`, W - M, 30, { align: 'right' })
    doc.text(`Date  ${d.doc_date || ''}`, W - M, 36, { align: 'right' })

    const barY = Math.max(26 + String(lh.address || '').split('\n').length * 4 + 6, 46)
    doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.4, 'F')
    let cy = barY + 9
    const colW = (W - 2 * M - 6) / 2

    function block(x, title, text) {
      doc.setDrawColor(r, g, b).setLineWidth(0.25)
      const lines = doc.splitTextToSize(text || '', colW - 8)
      const h = 12 + lines.length * 5
      doc.roundedRect(x, cy, colW, h, 2, 2, 'S')
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(r, g, b).text(title.toUpperCase(), x + 4, cy + 6)
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(30, 30, 30).text(lines, x + 4, cy + 12)
      return h
    }
    const h1 = block(M, 'Customer', d.customer)
    const h2 = block(M + colW + 6, 'Deliver to', d.deliver)
    cy += Math.max(h1, h2) + 8

    autoTable(doc, {
      startY: cy, margin: { left: M, right: M },
      head: [['#', 'Product', 'Hazard / UN', 'Packaging', 'Net (kg)', 'Gross (kg)']],
      body: (d.lines_snapshot || []).map((s, i) => {
        const hazard = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
        return [i + 1, s.productName, hazard, s.packDesc, n2(s.net), n2(s.gross)]
      }),
      styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, lineColor: [210, 220, 215], lineWidth: 0.15 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 34 },
        4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [240, 248, 244] },
    })

    const t = d.totals || {}
    const pallets = parseInt(t.pallets || 0, 10) || 0
    let ty = doc.lastAutoTable.finalY + 7
    const tx = W - M - 80
    doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(40, 40, 40)
    const totRows = [
      ['Total volume', n2(t.volume) + ' L'],
      ['Total net weight', n2(t.net) + ' kg'],
      ['Total gross weight', n2(t.gross) + ' kg'],
    ]
    if (pallets > 0) totRows.push(['Total pallets', String(pallets)])
    totRows.forEach(([k, v], i) => {
      if (i === totRows.length - 1) doc.setFont('helvetica', 'bold').setFontSize(13)
      doc.text(k, tx, ty); doc.text(v, W - M, ty, { align: 'right' }); ty += 6.5
    })

    if (d.options) {
      ty += 4
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110, 110, 110).text('NOTES', M, ty)
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 40)
        .text(doc.splitTextToSize(d.options, W - 2 * M), M, ty + 6)
      ty += 6 + doc.splitTextToSize(d.options, W - 2 * M).length * 5 + 4
    }

    ty += 6
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(r, g, b)
      .text('HAZARDOUS GOODS SUMMARY', M, ty)
    ty += 4

    const groups = hazardGroupsFromSnap(d.lines_snapshot)
    const rows = Object.entries(groups).map(([hazard, v]) => [
      hazard, v.vol > 0 ? n2(v.vol) + ' L' : '—', n2(v.net) + ' kg', n2(v.gross) + ' kg',
    ])
    autoTable(doc, {
      startY: ty, margin: { left: M, right: M },
      head: [['Hazard / Packing Group', 'Total Volume', 'Total Net Weight', 'Total Gross Weight']],
      body: rows,
      styles: { font: 'helvetica', fontSize: 11, cellPadding: 4, lineColor: [r, g, b], lineWidth: 0.4 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 65 },
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' },
      },
      tableLineColor: [r, g, b], tableLineWidth: 0.5,
      alternateRowStyles: { fillColor: [240, 248, 244] },
    })

    const afterHazard = doc.lastAutoTable.finalY
    const fy = 287
    if (afterHazard < fy - 10) {
      doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130, 130, 130)
        .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })
    }
    doc.save(`${String(d.doc_no).replace(/[^a-z0-9\-_]/gi, '_')}.pdf`)
  }))
}
