'use client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeLine, docTotals, fmt, prettyDate } from '@/lib/calc'

function hexToRgb(h) {
  const m = (h || '#e8853a').replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

// doc = { type, docNo, date, customer, deliver, lines }
// lh  = letterhead row { company, address, footer, color, logo }
export function generateDispatchPDF(doc_, lh, products, packaging) {
  const [r, g, b] = hexToRgb(lh.color)
  const t = docTotals(doc_.lines, products, packaging)
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

  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(r, g, b)
    .text(String(doc_.type || 'Delivery Note').toUpperCase(), W - M, 22, { align: 'right' })
  doc.setFont('courier', 'normal').setFontSize(9).setTextColor(40, 40, 40)
  doc.text(`No.   ${doc_.docNo || ''}`, W - M, 29, { align: 'right' })
  doc.text(`Date  ${prettyDate(doc_.date)}`, W - M, 34, { align: 'right' })

  const barY = Math.max(y + String(lh.address || '').split('\n').length * 4 + 8, 44)
  doc.setFillColor(r, g, b).rect(M, barY, W - 2 * M, 1.4, 'F')
  let cy = barY + 9
  const colW = (W - 2 * M - 6) / 2

  function block(x, title, text) {
    doc.setDrawColor(216, 210, 196).setLineWidth(0.2)
    const lines = doc.splitTextToSize(text || '', colW - 6)
    const h = 10 + lines.length * 4
    doc.roundedRect(x, cy, colW, h, 1.5, 1.5, 'S')
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(130, 130, 130).text(title.toUpperCase(), x + 3, cy + 5)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(30, 30, 30).text(lines, x + 3, cy + 10)
    return h
  }
  const h1 = block(M, 'Customer', doc_.customer)
  const h2 = block(M + colW + 6, 'Deliver to', doc_.deliver)
  cy += Math.max(h1, h2) + 8

  autoTable(doc, {
    startY: cy,
    margin: { left: M, right: M },
    head: [['#', 'Product', 'Pkg class', 'Packaging', 'Net (kg)', 'Gross (kg)']],
    body: doc_.lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      return [i + 1, c.productName, c.pg, c.packDesc, fmt(c.net), fmt(c.gross)]
    }),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.4, lineColor: [216, 210, 196], lineWidth: 0.1 },
    headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 28 },
      4: { halign: 'right', font: 'courier' }, 5: { halign: 'right', font: 'courier' },
    },
    alternateRowStyles: { fillColor: [247, 244, 236] },
  })

  let ty = doc.lastAutoTable.finalY + 6
  const tx = W - M - 70
  doc.setFont('courier', 'normal').setFontSize(9.5).setTextColor(40, 40, 40)
  const rows = [
    ['Total packages', String(t.packages)],
    ['Total volume', fmt(t.volume) + ' L'],
    ['Total net weight', fmt(t.net) + ' kg'],
    ['Total gross weight', fmt(t.gross) + ' kg'],
  ]
  rows.forEach(([k, v], i) => {
    if (i === rows.length - 1) doc.setFont('courier', 'bold')
    doc.text(k, tx, ty); doc.text(v, W - M, ty, { align: 'right' }); ty += 5.5
  })

  if (doc_.options) {
    ty += 3
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(110, 110, 110).text('NOTES', M, ty)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(40, 40, 40)
      .text(doc.splitTextToSize(doc_.options, W - 2 * M), M, ty + 5)
  }

  const fy = 287
  doc.setDrawColor(216, 210, 196).setLineWidth(0.2).line(M, fy - 4, W - M, fy - 4)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120, 120, 120)
    .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

  const safe = String(doc_.docNo || 'document').replace(/[^a-z0-9\-_]/gi, '_')
  doc.save(`${safe}.pdf`)
  return { totals: t }
}
