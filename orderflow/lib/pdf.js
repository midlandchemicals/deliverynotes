'use client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeLine, docTotals, fmt, ukDate, packSize, resolveLinePpl, VAT_RATE, VAT_LABEL } from '@/lib/calc'
import { registerFonts } from '@/lib/fonts'

let FONT = 'helvetica'

function hexToRgb(h) {
  const m = (h || '#197B55').replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

function fmtGBP(n) {
  if (!n) return '—'
  return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

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

function hazardGroups(lines, products, packaging) {
  const map = {}
  lines.forEach((l) => {
    const c = computeLine(l, products, packaging)
    const key = c.hazard || '—'
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0, psn: c.psn || '' }
    map[key].vol += c.totalVol; map[key].net += c.net; map[key].gross += c.gross
  })
  return map
}

function hazardGroupsFromSnap(snap) {
  const map = {}
  ;(snap || []).forEach((s) => {
    const key = s.hazard || (s.un_number ? `${s.un_number} · ${s.pg}` : (s.pg || '—'))
    if (key === '—') return
    if (!map[key]) map[key] = { vol: 0, net: 0, gross: 0, psn: s.psn || '' }
    map[key].vol += s.vol || 0; map[key].net += s.net || 0; map[key].gross += s.gross || 0
  })
  return map
}

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

function drawHazardBox(doc, startY, groups, r, g, b, M, W) {
  const entries = Object.entries(groups)
  if (!entries.length) return startY
  const boxW = W - 2 * M
  const innerW = boxW - 8
  const fontSize = 8
  const lineH = 3.5
  const entryGap = 1.8
  const segmentsFor = (hazard, v) => {
    const weights = (v.vol > 0 ? `Vol: ${fmt(v.vol)} L · ` : '') + `Net: ${fmt(v.net)} kg · Gross: ${fmt(v.gross)} kg`
    return [
      { text: hazard + '   ', bold: true, color: [20, 20, 20] },
      ...(v.psn ? [{ text: v.psn + '   ', bold: false, color: [60, 60, 60] }] : []),
      { text: weights, bold: false, color: [90, 90, 90] },
    ]
  }
  let contentH = 0
  const measured = entries.map(([hazard, v]) => {
    const parts = segmentsFor(hazard, v)
    const m = flowText(doc, M + 4, 0, innerW, fontSize, parts, lineH, true)
    contentH += m.lines * lineH + entryGap
    return { parts, lines: m.lines }
  })
  const boxH = 5 + contentH
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

function drawSigLines(doc, y, r, g, b, W, M) {
  const labels = ['Customer name', 'Print name', 'Date']
  const fw = 54, gap = 4
  doc.setFont(FONT, 'normal').setFontSize(8.5).setTextColor(80, 80, 80)
  labels.forEach((label, i) => {
    const sx = M + i * (fw + gap)
    doc.text(label, sx, y)
    doc.setDrawColor(r, g, b).setLineWidth(0.4).line(sx, y + 7, sx + fw, y + 7)
  })
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

// dd/mm/yy — compact form for tight table cells (batch column)
function ukShort(d) {
  const s = ukDate(d)
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.slice(0, 6) + s.slice(8) : s
}

function contactPdfLines(c) {
  if (!c) return []
  const out = []
  if (c.name) out.push(c.name)
  if (c.phone) out.push('Tel: ' + c.phone)
  if (c.email) out.push(c.email)
  return out
}

// Renders one complete copy of the delivery note onto the current page of `doc`.
// Call doc.addPage() before a second call to get two identical copies.
function renderDeliveryNote(doc, doc_, lh, products, packaging) {
  const [r, g, b] = hexToRgb(lh.color)
  const t = docTotals(doc_.lines, products, packaging)
  const pallets = Math.max(0, parseInt(doc_.pallets || 0, 10) || 0)
  const showHazard = doc_.showHazard !== false
  const W = 210, M = 16
  let y = 16

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

  doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
  const addrLines = String(lh.address || '').split('\n')
  doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(90, 90, 90).text(addrLines, M, y + 7)

  doc.setFont(FONT, 'bold').setFontSize(22).setTextColor(r, g, b)
    .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
  doc.setFont(FONT, 'normal').setFontSize(10).setTextColor(40, 40, 40)
  doc.text(`No.           ${doc_.docNo || ''}`, W - M, 28, { align: 'right' })
  if (doc_.orderDate) {
    doc.text(`Date ordered  ${ukDate(doc_.orderDate)}`, W - M, 34, { align: 'right' })
    doc.text(`Note date     ${ukDate(doc_.date)}`, W - M, 40, { align: 'right' })
  } else {
    doc.text(`Date  ${ukDate(doc_.date)}`, W - M, 34, { align: 'right' })
  }

  const headerBottom = doc_.orderDate ? 44 : 38
  const barY = Math.max(y + addrLines.length * 3.4 + 5, headerBottom)
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
  const bh1 = block(M, 'Invoice To', doc_.invoiceTo)
  const bh2 = block(rightX, 'Deliver To', doc_.deliver)
  let rightH = bh2
  const cLines = contactPdfLines(doc_.contact)
  if (cLines.length) {
    const cbh = block(rightX, 'Contact', cLines.join('\n'), cy + bh2 + 3)
    rightH = bh2 + 3 + cbh
  }
  cy += Math.max(bh1, rightH) + 5

  autoTable(doc, {
    startY: cy,
    margin: { left: M, right: M, bottom: 45 },
    head: [['Batch', 'Qty', 'Product', 'UN / PG', 'Net (kg)', 'Gross (kg)']],
    body: doc_.lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      const batch = (doc_.batches && doc_.batches[i]) || ''
      const mfg = (doc_.mfgDates && doc_.mfgDates[i]) || ''
      return [batch + (mfg ? `\nMfg ${ukShort(mfg)}` : ''), c.packQty, c.productName, c.hazardShort, fmt(c.net), fmt(c.gross)]
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

  const palletKg = pallets * 20
  const grossTotal = t.gross + palletKg
  let ty = doc.lastAutoTable.finalY + 5
  const tx = W - M - 78
  const totRows = [
    { label: 'Total volume',       val: fmt(t.volume) + ' L',    bold: false },
    { label: 'Total net weight',   val: fmt(t.net) + ' kg',      bold: false },
    { label: 'Total gross weight', val: fmt(grossTotal) + ' kg', bold: true  },
  ]
  if (pallets > 0) totRows.push({ label: 'Total pallets', val: String(pallets), bold: true })
  if (ty + totRows.length * 6 > 258) { doc.addPage(); ty = 20 }
  totRows.forEach(({ label, val, bold }) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
    doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
  })

  if (doc_.options) {
    ty += 3
    const noteLines = doc.splitTextToSize(doc_.options, W - 2 * M)
    if (ty + 5 + noteLines.length * 4.5 > 258) { doc.addPage(); ty = 20 }
    doc.setFont(FONT, 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
    doc.setFont(FONT, 'normal').setFontSize(9.5).setTextColor(40, 40, 40).text(noteLines, M, ty + 5)
    ty += 5 + noteLines.length * 4.5 + 3
  }

  if (showHazard) {
    ty += 4
    const groups = hazardGroups(doc_.lines, products, packaging)
    ty = drawHazardBox(doc, ty, groups, r, g, b, M, W)
  }

  const fy = 287
  drawSigLines(doc, fy - 22, r, g, b, W, M)
  doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
  doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
    .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

  return { totals: { ...t, gross: grossTotal, pallets, showHazard, invoice_to: doc_.invoiceTo || '' } }
}

// doc_ = { docNo, date, invoiceTo, deliver, contact, customerName, lines, batches, options, pallets, showHazard }
// Generates two identical copies of the delivery note in a single PDF file.
export function generateDispatchPDF(doc_, lh, products, packaging) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  FONT = registerFonts(doc)
  const { totals } = renderDeliveryNote(doc, doc_, lh, products, packaging)
  doc.addPage()
  renderDeliveryNote(doc, doc_, lh, products, packaging)
  const custName = doc_.customerName || (doc_.customer || '').split('\n')[0]
  window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
  return { totals }
}

// Office copy — B&W, "FOR OFFICE USE ONLY" banner, pricing columns + VAT + grand total.
// pricing key format: `${productId}::${packagingId}`
// tiersByKey (optional), same key -> [{from,to,ppl}]: quantity-break prices that
// override the base when the qty falls within a band.
// basisByKey (optional), same key -> 'line' | 'order': for 'order' rows the band
// is chosen by the combined pack qty of all 'order'-basis lines on the order.
// seasonByKey (optional), same key -> {from,to,ppl}: when doc_.orderDate falls in
// the recurring window the seasonal price overrides everything.
export function generateOfficeCopyPDF(doc_, lh, products, packaging, pricing = {}, deliveryCharge = 0, labelTotal = 0, tiersByKey = {}, basisByKey = {}, seasonByKey = {}) {
  const BK = [20, 20, 20]
  const MU = [90, 90, 90]
  const f2 = (n) => `£${(Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  FONT = registerFonts(doc)
  const W = 210, M = 16

  // Full-width black banner before everything else
  const bannerH = 17
  doc.setFillColor(0, 0, 0)
  doc.rect(0, 0, W, bannerH, 'F')
  doc.setFont(FONT, 'bold').setFontSize(19).setTextColor(255, 255, 255)
  doc.text('FOR OFFICE USE ONLY', W / 2, bannerH - 4, { align: 'center' })

  let y = bannerH + 6

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

  doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(...BK).text(lh.company || '', M, y + 2)
  const addrLines = String(lh.address || '').split('\n')
  doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(...MU).text(addrLines, M, y + 7)

  const titleY = y + 2
  doc.setFont(FONT, 'bold').setFontSize(22).setTextColor(...BK).text('DELIVERY NOTE', W - M, titleY, { align: 'right' })
  doc.setFont(FONT, 'normal').setFontSize(10).setTextColor(...MU)
  doc.text(`No.           ${doc_.docNo || ''}`, W - M, titleY + 9, { align: 'right' })
  if (doc_.orderDate) {
    doc.text(`Date ordered  ${ukDate(doc_.orderDate)}`, W - M, titleY + 15, { align: 'right' })
    doc.text(`Note date     ${ukDate(doc_.date)}`, W - M, titleY + 21, { align: 'right' })
  } else {
    doc.text(`Date  ${ukDate(doc_.date)}`, W - M, titleY + 15, { align: 'right' })
  }

  const barY = Math.max(y + addrLines.length * 3.4 + 5, doc_.orderDate ? titleY + 25 : titleY + 18)
  doc.setFillColor(80, 80, 80).rect(M, barY, W - 2 * M, 1.2, 'F')
  let cy = barY + 7
  const colW = (W - 2 * M - 5) / 2

  function block(x, title, text, yPos = cy) {
    doc.setDrawColor(120, 120, 120).setLineWidth(0.25)
    const bLines = doc.splitTextToSize(compactAddress(text || ''), colW - 10)
    const h = 11 + bLines.length * 3.9
    doc.roundedRect(x, yPos, colW, h, 2, 2, 'S')
    doc.setFont(FONT, 'bold').setFontSize(7).setTextColor(...MU).text(title.toUpperCase(), x + 5, yPos + 5.5)
    doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(...BK).text(bLines, x + 5, yPos + 10.5, { lineHeightFactor: 1.25 })
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

  // Combined pack qty across all 'order'-basis lines — the "mix" total.
  const combinedQty = doc_.lines.reduce((sum, l) => {
    const c = computeLine(l, products, packaging)
    if (!c.product || !c.packaging) return sum
    const k = `${c.product.id}::${c.packaging.id}`
    return basisByKey[k] === 'order' ? sum + (c.qty || 0) : sum
  }, 0)

  const lineData = doc_.lines.map((l, i) => {
    const c = computeLine(l, products, packaging)
    const key = `${c.product?.id}::${c.packaging?.id}`
    const ppl = resolveLinePpl({
      base: pricing[key], tiers: tiersByKey[key] || [], basis: basisByKey[key],
      season: seasonByKey[key] || null, orderDate: doc_.orderDate,
      lineQty: c.qty, combinedQty,
    })
    const unitPrice = ppl * (c.vol || 0)
    const lineTotal = unitPrice * c.qty
    const mfg = doc_.mfgDates?.[i] || ''
    return { c, unitPrice, lineTotal, batch: (doc_.batches?.[i] || '') + (mfg ? `\nMfg ${ukShort(mfg)}` : '') }
  })
  const subtotal = lineData.reduce((s, d) => s + d.lineTotal, 0)
  const delivery = parseFloat(deliveryCharge) || 0
  const labels = parseFloat(labelTotal) || 0
  const vat = Math.round((subtotal + labels + delivery) * VAT_RATE * 100) / 100
  const grandTotal = subtotal + labels + delivery + vat

  autoTable(doc, {
    startY: cy,
    margin: { left: M, right: M, bottom: 20 },
    head: [['Batch', 'Qty', 'Product', 'Unit (£)', 'Total (£)']],
    body: lineData.map(({ c, unitPrice, lineTotal, batch }) => [
      batch, c.packQty, c.productName,
      unitPrice > 0 ? fmtGBP(unitPrice) : '—',
      lineTotal > 0 ? fmtGBP(lineTotal) : '—',
    ]),
    styles: { font: FONT, fontSize: 9, cellPadding: 1.6, lineColor: [180, 180, 180], lineWidth: 0.15, textColor: BK },
    headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 18 },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  })

  let ty = doc.lastAutoTable.finalY + 5
  const tx = W - M - 78
  const totRows = [
    { label: 'Subtotal',              val: f2(subtotal),   bold: false },
    ...(labels > 0   ? [{ label: 'Labels',   val: f2(labels),   bold: false }] : []),
    ...(delivery > 0 ? [{ label: 'Delivery', val: f2(delivery), bold: false }] : []),
    { label: 'Total (ex VAT)',        val: f2(subtotal + labels + delivery), semi: true },
    { label: VAT_LABEL,               val: f2(vat),        bold: false },
    { label: 'Grand total',           val: f2(grandTotal), bold: true  },
  ]
  if (ty + totRows.length * 7 > 270) { doc.addPage(); ty = 20 }
  totRows.forEach(({ label, val, bold, semi }) => {
    doc.setFont(FONT, (bold || semi) ? 'bold' : 'normal').setFontSize(bold ? 13 : 11).setTextColor(...BK)
    if (bold) doc.setDrawColor(180, 180, 180).setLineWidth(0.3).line(tx, ty - 4, W - M, ty - 4)
    doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' })
    ty += bold ? 7 : 6
  })

  if (doc_.options) {
    ty += 4
    const noteLines = doc.splitTextToSize(doc_.options, W - 2 * M)
    if (ty + 5 + noteLines.length * 4.5 > 270) { doc.addPage(); ty = 20 }
    doc.setFont(FONT, 'bold').setFontSize(8.5).setTextColor(...MU).text('NOTES', M, ty)
    doc.setFont(FONT, 'normal').setFontSize(9.5).setTextColor(...BK).text(noteLines, M, ty + 5)
  }

  const fy = 287
  doc.setDrawColor(180, 180, 180).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
  doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
    .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })

  const custName = doc_.customerName || ''
  window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
}

// Price list export — one or more customers, each a branded section with
// a gridded product/price table.
// entries = [{ customer:{name}, rows:[{prod,pkg,vol,ppl,ppp}], lh:{letterhead} }]
// fallbackLh is used when an entry has no lh of its own.
export function generatePriceListPDF(entries, fallbackLh = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  FONT = registerFonts(doc)
  const W = 210, M = 16
  const f2 = (n) => (n || n === 0) ? `£${(Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const bandLabel = (t) => (t.to == null ? `${t.from}+` : (t.to === t.from ? `${t.from}` : `${t.from}-${t.to}`))

  entries.forEach((e, idx) => {
    if (idx > 0) doc.addPage()
    const lh = e.lh || fallbackLh
    const [r, g, b] = hexToRgb(lh.color || '#197B55')
    let y = 16

    if (lh.logo) {
      try {
        const props = doc.getImageProperties(lh.logo)
        const maxW = 38, maxH = 14
        let lw = maxW
        let logoH = (lw * props.height) / props.width
        if (logoH > maxH) { logoH = maxH; lw = (logoH * props.width) / props.height }
        const imgFmt = (lh.logo.match(/data:image\/(\w+)/) || [])[1]?.toUpperCase() || 'PNG'
        doc.addImage(lh.logo, imgFmt, M, y, lw, logoH); y += logoH + 2
      } catch (e2) {}
    }

    doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(r, g, b).text(lh.company || '', M, y + 2)
    doc.setFont(FONT, 'bold').setFontSize(20).setTextColor(40, 40, 40).text('PRICE LIST', W - M, y + 2, { align: 'right' })
    doc.setFont(FONT, 'normal').setFontSize(9).setTextColor(120, 120, 120)
      .text(ukDate(new Date().toISOString().slice(0, 10)), W - M, y + 8, { align: 'right' })
    y += 8

    doc.setFillColor(r, g, b).rect(M, y, W - 2 * M, 1.2, 'F')
    y += 7

    doc.setFont(FONT, 'bold').setFontSize(14).setTextColor(30, 30, 30).text(e.customer.name, M, y)
    y += 3
    if (e.rows.some((row) => (row.tiers || []).length)) {
      const hasCombined = e.rows.some((row) => (row.tiers || []).length && row.basis === 'order')
      y += 4
      doc.setFont(FONT, 'italic').setFontSize(8).setTextColor(120, 120, 120)
        .text(
          hasCombined
            ? 'Tiered items show £/litre by packs ordered. "Combined" bands count the total packs of all combined-price products together.'
            : 'Tiered items show £/litre by number of packs ordered (e.g. "3-4" = 3 to 4 packs).',
          M, y,
        )
      y -= 1
    }

    const threeTier = !!e.customer?.three_tier_pricing
    const money4 = (v) => (v != null ? `£${Number(v).toFixed(4)}` : '—')
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, bottom: 18 },
      head: threeTier
        ? [['Product', 'Range', 'Packaging', 'Trade £/L', 'Buyer group £/L', 'Retail £/L']]
        : [['Product', 'Range', 'Packaging', '£ / Litre', '£ / Pack']],
      body: e.rows.map((row) => {
        if (threeTier) {
          const lv = row.levels || {}
          return [row.prod.name, row.prod.category || '—', row.pkg.name, money4(lv.trade), money4(lv.buyer_group), money4(lv.retail)]
        }
        const tiers = row.tiers || []
        if (tiers.length) {
          // Quantity-break ladder: one line per band, aligned across both columns.
          const pplCell = tiers.map((t) => `${bandLabel(t)}:  £${(t.ppl || 0).toFixed(4)}`).join('\n')
          const pppCell = tiers.map((t) => (t.ppp != null ? f2(t.ppp) : '—')).join('\n')
          return [row.prod.name, row.prod.category || '—', row.pkg.name, pplCell, pppCell]
        }
        return [
          row.prod.name,
          row.prod.category || '—',
          row.pkg.name,
          row.ppl ? `£${row.ppl.toFixed(4)}` : '—',
          f2(row.ppp),
        ]
      }),
      styles: { font: FONT, fontSize: 9, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.2, textColor: [30, 30, 30] },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      columnStyles: threeTier
        ? { 3: { halign: 'right', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 28 }, 5: { halign: 'right', cellWidth: 24 } }
        : { 3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'right', cellWidth: 26, fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [240, 247, 244] },
    })

    const fy = 290
    doc.setDrawColor(200, 200, 200).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
    doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(140, 140, 140)
      .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })
  })

  window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
}

// Reprint from stored snapshot — two copies in one PDF.
// Newer notes store a slim letterhead snapshot (no embedded logo, just the
// letterhead id) to keep the database small — fetch the logo on demand.
export async function reprintPDF(d) {
  const lh = { ...(d.letterhead_snapshot || {}) }
  if (!lh.logo && lh.id) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const { data } = await createClient().from('letterheads').select('logo').eq('id', lh.id).single()
      if (data?.logo) lh.logo = data.logo
    } catch (e) { /* letterhead deleted — print without the logo */ }
  }
  import('jspdf').then(({ jsPDF }) => import('jspdf-autotable').then((mod) => {
    const autoTable = mod.default
    const [r, g, b] = hexToRgb(lh.color)
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    FONT = registerFonts(doc)
    const W = 210, M = 16
    const n2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })

    const draw = () => {
      let y = 16
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
      doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(20, 20, 20).text(lh.company || '', M, y + 2)
      const addrLines = String(lh.address || '').split('\n')
      doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(90, 90, 90).text(addrLines, M, y + 7)
      doc.setFont(FONT, 'bold').setFontSize(22).setTextColor(r, g, b)
        .text('DELIVERY NOTE', W - M, 20, { align: 'right' })
      doc.setFont(FONT, 'normal').setFontSize(10).setTextColor(40, 40, 40)
      doc.text(`No.   ${d.doc_no}`, W - M, 28, { align: 'right' })
      doc.text(`Date  ${ukDate(d.doc_date)}`, W - M, 34, { align: 'right' })
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
      autoTable(doc, {
        startY: cy, margin: { left: M, right: M, bottom: 45 },
        head: [['Batch', 'Qty', 'Product', 'UN / PG', 'Net (kg)', 'Gross (kg)']],
        body: (d.lines_snapshot || []).map((s) => {
          const pgNorm = String(s.pg || '').replace(/^PG\s*/i, '').trim()
          const hazardShort = s.un_number ? `${s.un_number}${pgNorm ? ` PG ${pgNorm}` : ''}` : (s.pg || '—')
          let packQty = s.packQty
          if (!packQty && s.packDesc) {
            const m = s.packDesc.match(/^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+)$/)
            packQty = m ? `${m[1]}x${packSize(m[2]) || m[2].trim()}` : s.packDesc.replace('×', 'x')
          }
          return [(s.batch || '') + (s.mfg_date ? `\nMfg ${ukShort(s.mfg_date)}` : ''), packQty || '', s.productName, hazardShort, n2(s.net), n2(s.gross)]
        }),
        styles: { font: FONT, fontSize: 9, cellPadding: 1.6, lineColor: [210, 220, 215], lineWidth: 0.15 },
        headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 3: { cellWidth: 26 },
          4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' },
        },
        alternateRowStyles: { fillColor: [242, 249, 245] },
      })
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
      if (ty + totRows.length * 6 > 258) { doc.addPage(); ty = 20 }
      totRows.forEach(({ label, val, bold }) => {
        doc.setFont(FONT, bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 11).setTextColor(40, 40, 40)
        doc.text(label, tx, ty); doc.text(val, W - M, ty, { align: 'right' }); ty += 6
      })
      if (d.options) {
        ty += 3
        const noteLines = doc.splitTextToSize(d.options, W - 2 * M)
        if (ty + 5 + noteLines.length * 4.5 > 258) { doc.addPage(); ty = 20 }
        doc.setFont(FONT, 'bold').setFontSize(8.5).setTextColor(r, g, b).text('NOTES', M, ty)
        doc.setFont(FONT, 'normal').setFontSize(9.5).setTextColor(40, 40, 40).text(noteLines, M, ty + 5)
        ty += 5 + noteLines.length * 4.5 + 3
      }
      if (showHazard) {
        ty += 4
        const groups = hazardGroupsFromSnap(d.lines_snapshot)
        ty = drawHazardBox(doc, ty, groups, r, g, b, M, W)
      }
      const fy = 287
      drawSigLines(doc, fy - 22, r, g, b, W, M)
      doc.setDrawColor(210, 220, 215).setLineWidth(0.2).line(M, fy - 5, W - M, fy - 5)
      doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(130, 130, 130)
        .text(doc.splitTextToSize(lh.footer || '', W - 2 * M), W / 2, fy, { align: 'center' })
    }

    draw()
    doc.addPage()
    draw()
    window.open(URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })), '_blank')
  }))
}
